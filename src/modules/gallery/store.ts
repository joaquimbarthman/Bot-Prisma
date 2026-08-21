import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { config } from "../../config.js";

export type GalleryComment = { userId: string; content: string; createdAt: string };
export type GalleryPost = { ownerId: string; likes: string[]; comments: GalleryComment[]; instagramHandle?: string };
type Database = Record<string, GalleryPost>;
const file = path.resolve(config.dataDir, "gallery.json");
let queue = Promise.resolve();
const supabase = config.supabaseUrl && config.supabaseSecretKey
  ? createClient(config.supabaseUrl, config.supabaseSecretKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })
  : null;

function fromRemote(row: Record<string, unknown>): GalleryPost {
  return {
    ownerId: String(row.owner_id),
    likes: Array.isArray(row.likes) ? row.likes.filter((value): value is string => typeof value === "string") : [],
    comments: Array.isArray(row.comments)
      ? row.comments.filter((value): value is GalleryComment => !!value && typeof value === "object" && typeof value.userId === "string" && typeof value.content === "string" && typeof value.createdAt === "string")
      : [],
    instagramHandle: typeof row.instagram_handle === "string" ? row.instagram_handle : undefined,
  };
}

function normalized(post: GalleryPost): GalleryPost {
  return {
    ...post,
    likes: Array.isArray(post.likes) ? post.likes : [],
    comments: Array.isArray(post.comments) ? post.comments : [],
  };
}

function toRemote(messageId: string, post: GalleryPost) {
  return {
    message_id: messageId,
    owner_id: post.ownerId,
    likes: post.likes,
    comments: post.comments,
    instagram_handle: post.instagramHandle ?? null,
    updated_at: new Date().toISOString(),
  };
}

async function read(): Promise<Database> {
  try { return JSON.parse(await readFile(file, "utf8")) as Database; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return {}; throw error; }
}

async function save(data: Database): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  await writeFile(temporary, JSON.stringify(data, null, 2), "utf8");
  await rename(temporary, file);
}

export async function createGalleryPost(messageId: string, ownerId: string, instagramHandle?: string): Promise<void> {
  if (supabase) {
    const { error } = await supabase.from("gallery_posts").upsert(toRemote(messageId, { ownerId, likes: [], comments: [], instagramHandle }), { onConflict: "message_id" });
    if (!error) return;
    console.error("[GALERIA] Não foi possível salvar a publicação no Supabase:", error.message);
  }
  queue = queue.then(async () => { const db = await read(); db[messageId] = { ownerId, likes: [], comments: [], instagramHandle }; await save(db); });
  await queue;
}

export async function getGalleryPost(messageId: string): Promise<GalleryPost | undefined> {
  if (supabase) {
    const { data, error } = await supabase.from("gallery_posts").select("*").eq("message_id", messageId).maybeSingle();
    if (!error) return data ? fromRemote(data) : undefined;
    console.error("[GALERIA] Não foi possível ler a publicação no Supabase:", error.message);
  }
  await queue;
  const post = (await read())[messageId];
  return post ? normalized(post) : undefined;
}

export async function listGalleryPosts(): Promise<Array<[string, GalleryPost]>> {
  if (supabase) {
    const { data, error } = await supabase.from("gallery_posts").select("*");
    if (!error) return (data ?? []).map((row) => [String(row.message_id), fromRemote(row)]);
    console.error("[GALERIA] Não foi possível listar publicações no Supabase:", error.message);
  }
  await queue;
  return Object.entries(await read()).map(([messageId, post]) => {
    const value = normalized(post);
    return [messageId, { ...value, likes: [...value.likes], comments: [...value.comments] }];
  });
}

export async function toggleGalleryLike(messageId: string, userId: string): Promise<{ liked: boolean; post?: GalleryPost }> {
  if (supabase) {
    const current = await getGalleryPost(messageId);
    if (!current) return { liked: false };
    const index = current.likes.indexOf(userId);
    const liked = index === -1;
    const next = { ...current, likes: liked ? [...current.likes, userId] : current.likes.filter((id) => id !== userId) };
    const { error } = await supabase.from("gallery_posts").upsert(toRemote(messageId, next), { onConflict: "message_id" });
    if (!error) return { liked, post: next };
    console.error("[GALERIA] Não foi possível atualizar curtida no Supabase:", error.message);
  }
  let result: { liked: boolean; post?: GalleryPost } = { liked: false };
  queue = queue.then(async () => {
    const db = await read(); const post = db[messageId];
    if (!post) return;
    const index = post.likes.indexOf(userId);
    const liked = index === -1;
    if (liked) post.likes.push(userId);
    else post.likes.splice(index, 1);
    result = { liked, post: { ...post, likes: [...post.likes], comments: [...(post.comments ?? [])] } };
    await save(db);
  });
  await queue; return result;
}

export async function addGalleryComment(messageId: string, userId: string, content: string): Promise<GalleryPost | undefined> {
  const comment: GalleryComment = { userId, content, createdAt: new Date().toISOString() };
  if (supabase) {
    const post = await getGalleryPost(messageId);
    if (!post) return undefined;
    const next = { ...post, comments: [...post.comments, comment] };
    const { error } = await supabase.from("gallery_posts").upsert(toRemote(messageId, next), { onConflict: "message_id" });
    if (!error) return next;
    console.error("[GALERIA] Não foi possível salvar comentário no Supabase:", error.message);
  }
  let result: GalleryPost | undefined;
  queue = queue.then(async () => {
    const db = await read(); const post = db[messageId];
    if (!post) return;
    post.comments ??= [];
    post.comments.push(comment);
    result = { ...post, likes: [...post.likes], comments: [...post.comments] };
    await save(db);
  });
  await queue;
  return result;
}

export async function updateGalleryInstagram(messageId: string, instagramHandle: string): Promise<GalleryPost | undefined> {
  if (supabase) {
    const post = await getGalleryPost(messageId);
    if (!post) return undefined;
    const next = { ...post, instagramHandle };
    const { error } = await supabase.from("gallery_posts").upsert(toRemote(messageId, next), { onConflict: "message_id" });
    if (!error) return next;
    console.error("[GALERIA] Não foi possível salvar Instagram no Supabase:", error.message);
  }
  let result: GalleryPost | undefined;
  queue = queue.then(async () => {
    const db = await read(); const post = db[messageId];
    if (!post) return;
    post.instagramHandle = instagramHandle;
    result = normalized(post);
    await save(db);
  });
  await queue;
  return result;
}

export async function deleteGalleryPost(messageId: string): Promise<void> {
  if (supabase) { await supabase.from("gallery_posts").delete().eq("message_id", messageId); return; }
  queue = queue.then(async () => { const db = await read(); delete db[messageId]; await save(db); });
  await queue;
}
