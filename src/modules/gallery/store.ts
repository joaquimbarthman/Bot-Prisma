import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { config } from "../../config.js";

export type GalleryPost = { ownerId: string; likes: string[]; reportPending?: boolean; reportDisabled?: boolean };
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
    reportPending: row.report_pending === true,
    reportDisabled: row.report_disabled === true,
  };
}

function toRemote(messageId: string, post: GalleryPost) {
  return {
    message_id: messageId,
    owner_id: post.ownerId,
    likes: post.likes,
    report_pending: post.reportPending ?? false,
    report_disabled: post.reportDisabled ?? false,
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

export async function createGalleryPost(messageId: string, ownerId: string): Promise<void> {
  if (supabase) {
    const { error } = await supabase.from("gallery_posts").upsert(toRemote(messageId, { ownerId, likes: [] }), { onConflict: "message_id" });
    if (!error) return;
    console.error("[GALERIA] Não foi possível salvar a publicação no Supabase:", error.message);
  }
  queue = queue.then(async () => { const db = await read(); db[messageId] = { ownerId, likes: [] }; await save(db); });
  await queue;
}

export async function getGalleryPost(messageId: string): Promise<GalleryPost | undefined> {
  if (supabase) {
    const { data, error } = await supabase.from("gallery_posts").select("*").eq("message_id", messageId).maybeSingle();
    if (!error) return data ? fromRemote(data) : undefined;
    console.error("[GALERIA] Não foi possível ler a publicação no Supabase:", error.message);
  }
  await queue; return (await read())[messageId];
}

export async function listGalleryPosts(): Promise<Array<[string, GalleryPost]>> {
  if (supabase) {
    const { data, error } = await supabase.from("gallery_posts").select("*");
    if (!error) return (data ?? []).map((row) => [String(row.message_id), fromRemote(row)]);
    console.error("[GALERIA] Não foi possível listar publicações no Supabase:", error.message);
  }
  await queue;
  return Object.entries(await read()).map(([messageId, post]) => [messageId, { ...post, likes: [...post.likes] }]);
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
    result = { liked, post: { ...post, likes: [...post.likes] } };
    await save(db);
  });
  await queue; return result;
}

export async function beginGalleryReport(messageId: string): Promise<"created" | "pending" | "disabled" | "missing"> {
  if (supabase) {
    const post = await getGalleryPost(messageId);
    if (!post) return "missing";
    if (post.reportDisabled) return "disabled";
    if (post.reportPending) return "pending";
    const { error } = await supabase.from("gallery_posts").update({ report_pending: true, updated_at: new Date().toISOString() }).eq("message_id", messageId);
    return error ? "missing" : "created";
  }
  let result: "created" | "pending" | "disabled" | "missing" = "missing";
  queue = queue.then(async () => {
    const db = await read(); const post = db[messageId];
    if (!post) return;
    if (post.reportDisabled) { result = "disabled"; return; }
    if (post.reportPending) { result = "pending"; return; }
    post.reportPending = true; result = "created"; await save(db);
  });
  await queue; return result;
}

export async function cancelGalleryReport(messageId: string): Promise<void> {
  if (supabase) { await supabase.from("gallery_posts").update({ report_pending: false, updated_at: new Date().toISOString() }).eq("message_id", messageId); return; }
  queue = queue.then(async () => { const db = await read(); if (db[messageId]) db[messageId].reportPending = false; await save(db); });
  await queue;
}

export async function verifyGalleryPost(messageId: string): Promise<GalleryPost | undefined> {
  if (supabase) {
    const post = await getGalleryPost(messageId);
    if (!post) return undefined;
    const next = { ...post, reportPending: false, reportDisabled: true };
    const { error } = await supabase.from("gallery_posts").upsert(toRemote(messageId, next), { onConflict: "message_id" });
    return error ? undefined : next;
  }
  let result: GalleryPost | undefined;
  queue = queue.then(async () => {
    const db = await read(); const post = db[messageId]; if (!post) return;
    post.reportPending = false; post.reportDisabled = true; result = { ...post, likes: [...post.likes] }; await save(db);
  });
  await queue; return result;
}

export async function deleteGalleryPost(messageId: string): Promise<void> {
  if (supabase) { await supabase.from("gallery_posts").delete().eq("message_id", messageId); return; }
  queue = queue.then(async () => { const db = await read(); delete db[messageId]; await save(db); });
  await queue;
}
