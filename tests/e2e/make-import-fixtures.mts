import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { crc32, deflateSync } from "node:zlib";
import { zipSync } from "fflate";
import writeXlsxFile from "write-excel-file/node";

const outDir = process.argv[2];
if (!outDir) throw new Error("Usage: tsx tests/e2e/make-import-fixtures.mts <output directory>");
mkdirSync(outDir, { recursive: true });

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function portrait(size: number, hue: [number, number, number]): Uint8Array {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 2;
  const rows: Buffer[] = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 3);
    for (let x = 0; x < size; x++) {
      const inside = (x - size / 2) ** 2 + (y - size * 0.42) ** 2 < (size * 0.22) ** 2 || (y > size * 0.68 && Math.abs(x - size / 2) < size * 0.3);
      row[1 + x * 3] = inside ? 235 : hue[0];
      row[2 + x * 3] = inside ? 220 : hue[1];
      row[3 + x * 3] = inside ? 200 : hue[2];
    }
    rows.push(row);
  }
  return new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", deflateSync(Buffer.concat(rows))), chunk("IEND", Buffer.alloc(0))]));
}

const headers = ["Full Name", "EMP NO", "Dept", "Shirt Size", "Photo"];
const rows = [
  ["Juan Dela Cruz", "EMP-001", "IT", "m", "EMP-001.png"],
  ["Maria Santos", "EMP-002", "HR", "S", "EMP-002.png"],
  ["Pedro Reyes", "EMP-003", "IT", "XL", "EMP-003.png"],
  ["No Identifier", "", "HR", "M", ""],
  ["Ana Lim", "EMP-005", "Finance", "L", "shared.png"],
  ["Ben Go", "EMP-006", "Finance", "L", "shared.png"],
  ["Carla Tan", "EMP-007", "IT", "M", "missing.png"],
  ["Dan Uy", "EMP-008", "IT", "M", "corrupt.jpg"],
];

await writeXlsxFile([headers.map((value) => ({ value })), ...rows.map((row) => row.map((value) => ({ value })))], {}).toFile(join(outDir, "participants.xlsx"));

const zip = zipSync({
  "photos/EMP-001.png": portrait(480, [47, 109, 181]),
  "photos/EMP-002.png": portrait(480, [184, 58, 46]),
  "EMP-003.png": portrait(480, [47, 122, 64]),
  "shared.png": portrait(480, [31, 118, 118]),
  "corrupt.jpg": new TextEncoder().encode("this is not really a jpeg"),
  "../evil.png": portrait(64, [0, 0, 0]),
  "__MACOSX/photos/._EMP-001.png": new Uint8Array([0, 5, 22, 7]),
  "notes.txt": new TextEncoder().encode("ignore me"),
  "EMP-009.heic": new Uint8Array([0, 0, 0, 24]),
});
writeFileSync(join(outDir, "participant-photos.zip"), zip);
console.log(`wrote participants.xlsx and participant-photos.zip to ${outDir}`);
