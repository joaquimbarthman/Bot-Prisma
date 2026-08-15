import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export type GalleryPost = { ownerId: string; likes: string[]; reportPending?: boolean; reportDisabled?: boolean };
type Database = Record<string, GalleryPost>;
const file = path.resolve("data", "gallery.json");
let queue = Promise.resolve();

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
  queue = queue.then(async () => { const db = await read(); db[messageId] = { ownerId, likes: [] }; await save(db); });
  await queue;
}

export async function getGalleryPost(messageId: string): Promise<GalleryPost | undefined> {
  await queue; return (await read())[messageId];
}

export async function listGalleryPosts(): Promise<Array<[string, GalleryPost]>> {
  await queue;
  return Object.entries(await read()).map(([messageId, post]) => [messageId, { ...post, likes: [...post.likes] }]);
}

export async function toggleGalleryLike(messageId: string, userId: string): Promise<{ liked: boolean; post?: GalleryPost }> {
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
  queue = queue.then(async () => { const db = await read(); if (db[messageId]) db[messageId].reportPending = false; await save(db); });
  await queue;
}

export async function verifyGalleryPost(messageId: string): Promise<GalleryPost | undefined> {
  let result: GalleryPost | undefined;
  queue = queue.then(async () => {
    const db = await read(); const post = db[messageId]; if (!post) return;
    post.reportPending = false; post.reportDisabled = true; result = { ...post, likes: [...post.likes] }; await save(db);
  });
  await queue; return result;
}

export async function deleteGalleryPost(messageId: string): Promise<void> {
  queue = queue.then(async () => { const db = await read(); delete db[messageId]; await save(db); });
  await queue;
}
