import express from "express";
import { spawn } from "node:child_process";
import { mkdtemp, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const app = express();
const PORT = process.env.PORT || 3000;
app.use(express.static("public"));

const HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be", "music.youtube.com"]);
const HEIGHTS = new Set(["360", "480", "720", "1080", "best"]);

function validUrl(raw) {
  try {
    const u = new URL(raw);
    return ["http:", "https:"].includes(u.protocol) && HOSTS.has(u.hostname);
  } catch {
    return false;
  }
}

function run(args) {
  return new Promise((resolve, reject) => {
    const p = spawn("yt-dlp", args);
    let out = "", err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("error", () => reject(new Error("yt-dlp is not installed or not on PATH")));
    p.on("close", (code) => (code === 0 ? resolve(out) : reject(new Error(err.split("\n").filter(Boolean).pop() || "yt-dlp failed"))));
  });
}

// Video details for the preview card
app.get("/api/info", async (req, res) => {
  const { url } = req.query;
  if (!validUrl(url)) return res.status(400).json({ error: "Enter a valid YouTube link." });
  try {
    const info = JSON.parse(await run(["-J", "--no-playlist", "--", url]));
    res.json({
      title: info.title,
      channel: info.uploader,
      duration: info.duration,
      thumbnail: info.thumbnail,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Download to a temp folder, send the file, then delete it
app.get("/api/download", async (req, res) => {
  const { url, type = "mp4", height = "720" } = req.query;
  if (!validUrl(url)) return res.status(400).json({ error: "Enter a valid YouTube link." });
  if (!["mp4", "mp3"].includes(type) || !HEIGHTS.has(height)) return res.status(400).json({ error: "Invalid options." });

  const dir = await mkdtemp(path.join(tmpdir(), "ytd-"));
  const cleanup = () => rm(dir, { recursive: true, force: true }).catch(() => {});
  try {
    const args = ["--no-playlist", "--restrict-filenames", "-o", path.join(dir, "%(title).80s.%(ext)s")];
    if (type === "mp3") {
      args.push("-x", "--audio-format", "mp3", "--audio-quality", "0");
    } else {
      const cap = height === "best" ? "" : `[height<=${height}]`;
      args.push("-f", `bv*${cap}+ba/b${cap}`, "--merge-output-format", "mp4");
    }
    await run([...args, "--", url]);
    const [file] = await readdir(dir);
    if (!file) throw new Error("Download produced no file.");
    res.download(path.join(dir, file), file, cleanup);
  } catch (e) {
    await cleanup();
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => console.log(`Running at http://localhost:${PORT}`));
