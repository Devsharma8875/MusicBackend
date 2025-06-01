require("dotenv").config();
const express = require("express");
const axios = require("axios");
const { exec } = require("child_process");
const app = express();
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;
const port = process.env.PORT || 3000;

app.use(express.json());
app.use(require("cors")());

app.get("/", (req, res) => {
  res.send("🎵 YouTube Audio Stream & Download API");
});

function formatDuration(isoDuration) {
  if (!isoDuration) return "Unknown";
  const match = isoDuration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return isoDuration;

  const hours = match[1] ? `${match[1]}:` : "";
  const minutes = match[2] || "0";
  const seconds = match[3] ? match[3].padStart(2, "0") : "00";

  return hours + minutes + (hours ? "" : "") + ":" + seconds;
}
app.get("/related/:id", async (req, res) => {
  try {
    const videoId = req.params.id;

    // First get the original video's details to find the movie/album name
    const videoInfo = await axios.get(
      `https://www.googleapis.com/youtube/v3/videos`,
      {
        params: {
          part: "snippet",
          id: videoId,
          key: YOUTUBE_API_KEY,
        },
      }
    );

    if (!videoInfo.data.items?.length) {
      throw new Error("Video not found");
    }

    const originalTitle = videoInfo.data.items[0].snippet.title;
    const channelId = videoInfo.data.items[0].snippet.channelId;

    // Extract movie/album name from title (e.g. "Titanic - My Heart Will Go On" => "Titanic")
    const movieAlbumName = extractMovieAlbumName(originalTitle);

    // Search for other songs from same movie/album
    const searchResults = await axios.get(
      `https://www.googleapis.com/youtube/v3/search`,
      {
        params: {
          part: "snippet",
          q: `${movieAlbumName} songs`, // Search for other songs
          type: "video",
          channelId: channelId, // Limit to same channel (usually same movie/album)
          maxResults: 15,
          key: YOUTUBE_API_KEY,
        },
      }
    );

    // Get details for all found videos
    const videoIds = searchResults.data.items
      .map((item) => item.id.videoId)
      .join(",");
    const videosDetails = await axios.get(
      `https://www.googleapis.com/youtube/v3/videos`,
      {
        params: {
          part: "snippet,contentDetails",
          id: videoIds,
          key: YOUTUBE_API_KEY,
        },
      }
    );

    const relatedSongs = videosDetails.data.items.map((video) => ({
      id: video.id,
      title: video.snippet.title,
      thumbnail: video.snippet.thumbnails.medium.url,
      author: video.snippet.channelTitle,
      duration: formatDuration(video.contentDetails.duration),
    }));

    res.json({
      movieAlbum: movieAlbumName,
      songs: relatedSongs.filter((song) => song.id !== videoId), // Exclude original
    });
  } catch (error) {
    console.error("Error:", error.response?.data || error.message);

    // Fallback using yt-dlp
    const videoId = req.params.id;
    exec(
      `yt-dlp --flat-playlist --print "%(id)s,%(title)s,%(uploader)s,%(duration_string)s" "https://www.youtube.com/watch?v=${videoId}"`,
      (error, stdout, stderr) => {
        if (error) {
          return res.status(500).json({
            error: "Failed to fetch related songs",
            details: stderr || "Both methods failed",
          });
        }

        const allVideos = stdout
          .trim()
          .split("\n")
          .filter((line) => line)
          .map((line) => {
            const [id, title, author, duration] = line.split(",");
            return {
              id,
              title,
              thumbnail: `https://img.youtube.com/vi/${id}/mqdefault.jpg`,
              author,
              duration,
            };
          });

        // Try to find other songs from same movie/album
        const originalTitle = allVideos[0]?.title || "";
        const movieAlbumName = extractMovieAlbumName(originalTitle);

        const relatedSongs = allVideos.filter(
          (video) =>
            video.id !== videoId && video.title.includes(movieAlbumName)
        );

        res.json({
          fallbackMethodUsed: true,
          movieAlbum: movieAlbumName,
          songs: relatedSongs.slice(0, 10),
        });
      }
    );
  }
});

// Helper function to extract movie/album name
function extractMovieAlbumName(title) {
  // Patterns like: "Movie - Song", "Movie: Song", "Movie Song"
  const patterns = [
    /^(.*?)[\-:]/i, // "Titanic - My Heart Will Go On"
    /^(.*?)\s(?:song|track|ost)/i, // "Titanic My Heart Will Go On song"
    /^(.*?)\s\(\d{4}\)/i, // "Titanic (1997)"
  ];

  for (const pattern of patterns) {
    const match = title.match(pattern);
    if (match) return match[1].trim();
  }

  return title.split(" ")[0]; // Fallback to first word
}
app.get("/song/:id", (req, res) => {
  const videoId = req.params.id;
  if (!videoId || videoId === "undefined") {
    return res.status(400).json({ error: "Invalid YouTube video ID" });
  }

  const youtubeUrl = `https://www.youtube.com/watch?v=${videoId}`;

  exec(`yt-dlp -g -f "ba" "${youtubeUrl}"`, (error, stdout, stderr) => {
    if (error) {
      console.error(`Error: ${stderr}`);
      return res.status(500).json({ error: "Failed to fetch audio URL" });
    }
    const audioFormatHigh = stdout.trim();
    res.json({ audioFormatHigh });
  });
});
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
