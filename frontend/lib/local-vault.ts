/**
 * 로컬 볼트(File System Access API) 래퍼.
 *
 * 옵시디언처럼 "로컬 폴더가 원본"이라는 모델 - 사용자가 브라우저 파일 선택기로
 * 폴더 하나를 고르면, 노트는 그 폴더 아래 notes/*.md 로 그대로 저장된다.
 * 서버 동기화(프리미엄)는 이번 범위 밖이라 여기서는 로컬 읽기/쓰기만 다룬다.
 *
 * File System Access API는 TS lib.dom에 FileSystemDirectoryHandle/FileHandle
 * 자체는 있지만 showDirectoryPicker, 권한(query/requestPermission), 디렉터리
 * 순회(entries)가 빠져 있다 - tsconfig를 건드리지 않기 위해 이 파일 안에서만
 * 전역 선언을 보강한다.
 */

declare global {
  interface FileSystemHandlePermissionDescriptor {
    mode?: "read" | "readwrite";
  }
  interface FileSystemHandle {
    queryPermission(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
    requestPermission(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
  }
  interface FileSystemDirectoryHandle {
    entries(): AsyncIterableIterator<[string, FileSystemDirectoryHandle | FileSystemFileHandle]>;
  }
  interface Window {
    showDirectoryPicker(options?: {
      mode?: "read" | "readwrite";
      id?: string;
    }): Promise<FileSystemDirectoryHandle>;
  }
}

/** ElementNotesPanel.tsx의 ElementNote와 형태가 완전히 같다 - 볼트에서 읽은
 * 노트도 그대로 notes state에 얹을 수 있어야 별도 변환 계층이 필요 없다. */
export interface VaultNote {
  id: string;
  nodeId: string;
  title: string;
  body: string;
  isPublic: boolean;
  attachments: never[];
  createdAt: number;
  updatedAt: number;
}

export interface VaultHandle {
  dir: FileSystemDirectoryHandle;
  name: string;
}

export function isVaultSupported(): boolean {
  return typeof window !== "undefined" && "showDirectoryPicker" in window;
}

// --- IndexedDB: 디렉터리 핸들 하나만 보관 -----------------------------------
// idb 라이브러리 없이 raw indexedDB를 Promise로 감싼 최소 래퍼. 스토어 하나,
// 키 하나("root")만 쓰는 아주 좁은 용도라 범용 헬퍼를 만들지 않는다.
const DB_NAME = "ourlab-vault";
const STORE_NAME = "handles";
const HANDLE_KEY = "root";

function openHandleDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE_NAME)) {
        req.result.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGetHandle(): Promise<FileSystemDirectoryHandle | undefined> {
  const db = await openHandleDb();
  try {
    return await new Promise((resolve, reject) => {
      const req = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(HANDLE_KEY);
      req.onsuccess = () => resolve(req.result as FileSystemDirectoryHandle | undefined);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

async function idbSetHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  const db = await openHandleDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const req = db.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).put(handle, HANDLE_KEY);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

async function idbDeleteHandle(): Promise<void> {
  const db = await openHandleDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const req = db.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).delete(HANDLE_KEY);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

// --- 연결/해제 --------------------------------------------------------------

export async function connectVault(): Promise<VaultHandle | null> {
  if (!isVaultSupported()) return null;
  try {
    const dir = await window.showDirectoryPicker({ mode: "readwrite", id: "ourlab-vault" });
    await idbSetHandle(dir);
    return { dir, name: dir.name };
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") return null; // 사용자 취소
    throw err;
  }
}

/** 마운트 시 이전 연결을 복원한다. requestPermission은 사용자 제스처(클릭) 안에서만
 * 동작하므로 여기서 자동 호출하지 않고, needsPermission으로 알려서 버튼 클릭에서
 * requestVaultPermission을 부르게 한다. */
export async function restoreVault(): Promise<{ handle: VaultHandle; needsPermission: boolean } | null> {
  if (!isVaultSupported()) return null;
  const dir = await idbGetHandle();
  if (!dir) return null;
  const perm = await dir.queryPermission({ mode: "readwrite" });
  return { handle: { dir, name: dir.name }, needsPermission: perm !== "granted" };
}

export async function requestVaultPermission(handle: VaultHandle): Promise<boolean> {
  const perm = await handle.dir.requestPermission({ mode: "readwrite" });
  return perm === "granted";
}

export async function disconnectVault(): Promise<void> {
  await idbDeleteHandle();
}

// --- 노트 파일 형식 ----------------------------------------------------------

/** 파일계 금지문자(Windows 기준 \/:*?"<>|)와 개행 제거 + 80자 클램프. 빈
 * 제목은 "무제"로 대체한다. */
function sanitizeTitle(title: string): string {
  const cleaned = title.replace(/[\\/:*?"<>|\r\n]/g, "").trim();
  return (cleaned || "무제").slice(0, 80);
}

/** "vault:filename" 승격 id는 콜론을 담고 있어 파일명 접미사로 못 쓴다(Windows
 * 금지문자) - 그런 id에는 간단한 결정론적 해시를 접미사로 쓴다. 실제 id는
 * 그대로(승격 후에도 "vault:"+원본파일명) 유지해 page.tsx state의 키가 바뀌지
 * 않게 한다. ponytail: 해시 충돌은 이 용도(같은 볼트 안 파일명 구분)에서
 * 무시할 만한 수준 - 실제로 문제되면 파일 스캔 기반 유니크화로 승격.
 */
function filenameSuffix(id: string): string {
  if (!id.startsWith("vault:")) return id.slice(0, 6);
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h.toString(36).padEnd(6, "0").slice(0, 6);
}

function noteFileName(id: string, title: string): string {
  return `${sanitizeTitle(title)}-${filenameSuffix(id)}.md`;
}

function serializeNote(note: VaultNote, nodeLabel: string): string {
  const front = [
    "---",
    `ourlab-note-id: ${note.id}`,
    `ourlab-node-id: ${note.nodeId}`,
    `ourlab-node-label: ${nodeLabel}`,
    `is-public: ${note.isPublic}`,
    `created: ${new Date(note.createdAt).toISOString()}`,
    `updated: ${new Date(note.updatedAt).toISOString()}`,
    "---",
    "",
  ].join("\n");
  return front + note.body;
}

/** YAML 라이브러리 없이 "key: value" 줄만 읽는 단순 파서 - 우리가 직접 쓰는
 * front-matter만 왕복하면 되므로 중첩/배열/따옴표 이스케이프는 다루지 않는다. */
function parseFrontMatter(text: string): { data: Record<string, string>; body: string } | null {
  const lines = text.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return null;
  const data: Record<string, string> = {};
  let closeIndex = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      closeIndex = i;
      break;
    }
    const idx = lines[i].indexOf(":");
    if (idx === -1) continue;
    data[lines[i].slice(0, idx).trim()] = lines[i].slice(idx + 1).trim();
  }
  if (closeIndex === -1) return null; // 닫는 --- 없으면 front-matter 아님 취급
  const body = lines.slice(closeIndex + 1).join("\n").replace(/^\n/, "");
  return { data, body };
}

/** 정식 노트(front-matter 있음)의 파일명에서 우리가 붙인 id 접미사를 떼어
 * 제목을 복원한다 - id를 이미 알고 있으므로(front-matter에서 읽음) 추측이
 * 아니라 정확히 그 접미사만 제거한다. */
function stripKnownSuffix(basename: string, id: string): string {
  const suffix = `-${filenameSuffix(id)}`;
  return basename.endsWith(suffix) ? basename.slice(0, -suffix.length) : basename;
}

async function findFileForNoteId(
  notesDir: FileSystemDirectoryHandle,
  id: string
): Promise<{ name: string; handle: FileSystemFileHandle } | null> {
  if (id.startsWith("vault:")) {
    const name = id.slice("vault:".length);
    try {
      return { name, handle: await notesDir.getFileHandle(name) };
    } catch {
      return null; // 원본 파일이 그새 지워졌거나 이름이 바뀜
    }
  }
  const suffix = `-${filenameSuffix(id)}.md`;
  for await (const [name, entry] of notesDir.entries()) {
    if (entry.kind === "file" && name.endsWith(suffix)) {
      return { name, handle: entry as FileSystemFileHandle };
    }
  }
  return null;
}

/** notes/ 아래 .md를 전부 읽는다. front-matter가 있고 ourlab-note-id가 있으면
 * 정식 노트, 없으면(옵시디언에서 만든 생파일 등) 파일명/lastModified로 채운
 * 읽기용 노트를 돌려준다(nodeId는 "" - 호출부가 미분류로 다룬다). */
export async function listVaultNotes(handle: VaultHandle): Promise<VaultNote[]> {
  const notesDir = await handle.dir.getDirectoryHandle("notes", { create: true });
  const out: VaultNote[] = [];
  for await (const [name, entry] of notesDir.entries()) {
    if (entry.kind !== "file" || !name.toLowerCase().endsWith(".md")) continue;
    let file: File;
    try {
      file = await (entry as FileSystemFileHandle).getFile();
    } catch {
      continue; // 읽다 실패한 파일 하나 때문에 전체 목록을 죽이지 않는다.
    }
    const text = await file.text();
    const parsed = parseFrontMatter(text);
    const id = parsed?.data["ourlab-note-id"];
    const basename = name.slice(0, -3);
    if (parsed && id) {
      const created = Date.parse(parsed.data["created"] ?? "");
      const updated = Date.parse(parsed.data["updated"] ?? "");
      out.push({
        id,
        nodeId: parsed.data["ourlab-node-id"] ?? "",
        title: stripKnownSuffix(basename, id),
        body: parsed.body,
        isPublic: parsed.data["is-public"] === "true",
        attachments: [],
        createdAt: Number.isNaN(created) ? file.lastModified : created,
        updatedAt: Number.isNaN(updated) ? file.lastModified : updated,
      });
    } else {
      out.push({
        id: `vault:${name}`,
        nodeId: "",
        title: basename,
        body: text,
        isPublic: false,
        attachments: [],
        createdAt: file.lastModified,
        updatedAt: file.lastModified,
      });
    }
  }
  return out;
}

/** 노트를 쓴다 - 제목이 바뀌어 파일명이 달라지면 새 이름으로 쓰고 옛 파일을
 * 지운다. nodeLabel은 front-matter 표시용(호출부가 CanvasNode에서 조회). */
export async function writeVaultNote(handle: VaultHandle, note: VaultNote, nodeLabel: string): Promise<void> {
  const notesDir = await handle.dir.getDirectoryHandle("notes", { create: true });
  const old = await findFileForNoteId(notesDir, note.id);
  const newName = noteFileName(note.id, note.title);
  const content = serializeNote(note, nodeLabel);
  const fileHandle = await notesDir.getFileHandle(newName, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(content);
  await writable.close();
  if (old && old.name !== newName) {
    await notesDir.removeEntry(old.name);
  }
}

export async function deleteVaultNote(handle: VaultHandle, noteId: string): Promise<void> {
  const notesDir = await handle.dir.getDirectoryHandle("notes", { create: true });
  const found = await findFileForNoteId(notesDir, noteId);
  if (found) await notesDir.removeEntry(found.name);
}

/** 순수 헬퍼(파일계 접근 없음)만 검증하는 최소 자가 점검 - 프레임워크 없이
 * assert만. 자동 실행되지 않고, 로직을 건드릴 때 콘솔에서 수동으로
 * `runLocalVaultSelfCheck()`를 불러 회귀를 확인한다. */
export function runLocalVaultSelfCheck(): void {
  const assert = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(`local-vault self-check 실패: ${msg}`);
  };
  assert(sanitizeTitle("") === "무제", "빈 제목은 무제로");
  assert(sanitizeTitle('a/b:c*d?e"f<g>h|i') === "abcdefghi", "금지문자 제거");
  assert(sanitizeTitle("x".repeat(200)).length === 80, "80자 클램프");

  const note: VaultNote = {
    id: "note-local-abcdef12",
    nodeId: "element:course-1",
    title: "테스트 노트",
    body: "본문 **강조**",
    isPublic: true,
    attachments: [],
    createdAt: Date.UTC(2026, 0, 1),
    updatedAt: Date.UTC(2026, 0, 2),
  };
  const serialized = serializeNote(note, "회계원리(1)");
  const parsed = parseFrontMatter(serialized);
  assert(!!parsed, "front-matter 파싱 성공");
  assert(parsed!.data["ourlab-note-id"] === note.id, "id 왕복");
  assert(parsed!.data["is-public"] === "true", "is-public 왕복");
  assert(parsed!.body === note.body, "본문 왕복");

  assert(filenameSuffix(note.id) === note.id.slice(0, 6), "일반 id는 앞 6자");
  assert(filenameSuffix("vault:my file.md").length === 6, "vault: id는 해시 6자");
  assert(!filenameSuffix("vault:my file.md").includes(":"), "vault: id 접미사엔 콜론 없음");

  assert(parseFrontMatter("본문만 있고 front-matter 없음") === null, "front-matter 없으면 null");
}
