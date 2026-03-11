import { tool } from "@opencode-ai/plugin"

type XApiPost = {
  id: string
  text?: string
  note_tweet?: {
    text?: string
  }
  author_id?: string
  created_at?: string
  lang?: string
  public_metrics?: {
    like_count?: number
    reply_count?: number
    repost_count?: number
    quote_count?: number
    impression_count?: number
    bookmark_count?: number
  }
}

type XApiUser = {
  id: string
  name: string
  username: string
}

type XApiMedia = {
  media_key: string
  type: string
  url?: string
  preview_image_url?: string
  alt_text?: string
}

type XApiResponse = {
  data?: XApiPost
  includes?: {
    users?: XApiUser[]
    media?: XApiMedia[]
  }
  errors?: Array<{
    message?: string
    detail?: string
    title?: string
  }>
}

function extractPostId(input: string) {
  const trimmed = input.trim()

  if (/^\d+$/.test(trimmed)) return trimmed

  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    throw new Error("Expected an X post URL or numeric post ID")
  }

  const parts = url.pathname.split("/").filter(Boolean)
  const statusIndex = parts.findIndex((part) => part === "status")
  if (statusIndex === -1) {
    throw new Error("Could not find a post ID in that X URL")
  }

  const postId = parts[statusIndex + 1]
  if (!postId || !/^\d+$/.test(postId)) {
    throw new Error("That X URL does not contain a valid numeric post ID")
  }

  return postId
}

function formatPost(response: XApiResponse, sourceUrl: string) {
  const post = response.data
  if (!post) {
    const message = response.errors?.map((error) => error.detail ?? error.message ?? error.title).filter(Boolean).join("; ")
    throw new Error(message || "X API returned no post data")
  }

  const author = response.includes?.users?.find((user) => user.id === post.author_id)
  const media = response.includes?.media ?? []
  const text = post.note_tweet?.text?.trim() || post.text?.trim() || ""
  const metrics = post.public_metrics

  const lines = [
    `URL: ${sourceUrl}`,
    `Post ID: ${post.id}`,
    author ? `Author: ${author.name} (@${author.username})` : undefined,
    post.created_at ? `Created: ${post.created_at}` : undefined,
    post.lang ? `Language: ${post.lang}` : undefined,
    metrics
      ? `Metrics: ${metrics.like_count ?? 0} likes, ${metrics.reply_count ?? 0} replies, ${metrics.repost_count ?? 0} reposts, ${metrics.quote_count ?? 0} quotes, ${metrics.bookmark_count ?? 0} bookmarks, ${metrics.impression_count ?? 0} impressions`
      : undefined,
    "",
    "Text:",
    text || "[No text returned]",
  ].filter(Boolean)

  if (media.length > 0) {
    lines.push("", "Media:")
    for (const item of media) {
      const mediaLine = [
        `- ${item.type}`,
        item.url || item.preview_image_url,
        item.alt_text ? `alt: ${item.alt_text}` : undefined,
      ].filter(Boolean).join(" | ")
      lines.push(mediaLine)
    }
  }

  return lines.join("\n")
}

export default tool({
  description: "Read a public X post by URL or numeric post ID",
  args: {
    input: tool.schema.string().describe("An X post URL like https://x.com/.../status/... or a numeric post ID"),
  },
  async execute(args) {
    const bearerToken = process.env.X_BEARER_TOKEN
    if (!bearerToken) {
      throw new Error("Missing X_BEARER_TOKEN in .env")
    }

    const postId = extractPostId(args.input)
    const sourceUrl = /^https?:\/\//.test(args.input.trim())
      ? args.input.trim()
      : `https://x.com/i/status/${postId}`

    const url = new URL(`https://api.x.com/2/tweets/${postId}`)
    url.searchParams.set("expansions", "author_id,attachments.media_keys")
    url.searchParams.set("tweet.fields", "created_at,lang,note_tweet,public_metrics")
    url.searchParams.set("user.fields", "name,username")
    url.searchParams.set("media.fields", "type,url,preview_image_url,alt_text")

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${bearerToken}`,
      },
    })

    const payload = await response.json() as XApiResponse
    if (!response.ok) {
      const message = payload.errors?.map((error) => error.detail ?? error.message ?? error.title).filter(Boolean).join("; ")
      throw new Error(message || `X API request failed with status ${response.status}`)
    }

    return formatPost(payload, sourceUrl)
  },
})
