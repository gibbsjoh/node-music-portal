// ********************************************** Dependencies ***************************************
const express = require('express');
const fs = require('fs');
const path = require('path');
const { spawn, exec } = require('child_process');
const https = require('https');
require('dotenv').config();
const session = require('express-session');

// ********************************************** CONSTANTS ***************************************
// ******* Configure Express ******
const app = express();
const PORT = 3000;

// View engine and static files
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static('public'));
app.use(express.json());

app.use(session({
  secret: 'yomama',
  resave: false,
  saveUninitialized: true
}));

// SSL config
const sslOptions = {
  key: fs.readFileSync('server.key'),
  cert: fs.readFileSync('server.cert')
};

// ******* Set music dir here! ******
const MUSIC_DIR = '/home/pi/Music';


// ******* WaveShare Pi UPS ******
const Ina219Board = require('ina219-async');
const ina219 = Ina219Board(i2cAddress = 0x43, i2cBus = 1);

let currentBattery = { powerStatus: 'Unknown', volts: 0.0 };

let currentStreamProcess = null;
let streamStatus = 'idle';

// Playback state
let playQueue = [];
let nowPlaying = null;
let isPlaying = false;
let isPaused = false;
let currentProcess = null;

let lastPlaybackError = null;
let playbackStarted = false;


// ****************************** END CONSTANTS ************************************

// <><><><><><><><><><><><><><><><><><><><><><><><><><><><><><><><><><><><><><><><><><><><><><><><><><><><><><><><>

// ****************************** FUNCTIONS ************************************

// Pi-UPS - query battery status ******
async function getBatteryStatus() {
  await ina219.calibrate32V2A();
  const volts = await ina219.getBusVoltage_V();
  const current = await ina219.getCurrent_mA();
  const powerStatus = current < 0 ? 'On Battery' : 'On Mains';
  ina219.closeSync();
  return { powerStatus, volts };
}

// 📁 File scanner
function getDirectoryView(relDir = '') {
  const dirPath = path.join(MUSIC_DIR, relDir);
  let entries = [];

  try {
    const dirEntries = fs.readdirSync(dirPath, { withFileTypes: true });
    dirEntries.forEach(entry => {
      const fullPath = path.join(dirPath, entry.name);
      const relPath = path.relative(MUSIC_DIR, fullPath);
      entries.push({
        name: entry.name,
        relPath,
        isDirectory: entry.isDirectory(),
        isAudio: entry.isFile() && entry.name.match(/\.(mp3|flac|m4a)$/)
      });
    });
  } catch (err) {
    console.error('Error reading directory:', err);
  }

  return entries;
}
// old version:
// function getDirectoryContents(relDir = '') {
//   const dirPath = path.join(MUSIC_DIR, relDir);
//   let files = [];

//   function walk(dir) {
//     const entries = fs.readdirSync(dir, { withFileTypes: true });
//     entries.forEach(entry => {
//       const fullPath = path.join(dir, entry.name);
//       const relPath = path.relative(MUSIC_DIR, fullPath);
//       if (entry.isDirectory()) {
//         walk(fullPath);
//       } else if (entry.name.match(/\.(mp3|flac|m4a)$/)) {
//         files.push(relPath);
//       }
//     });
//   }

//   try {
//     walk(dirPath);
//   } catch (err) {
//     console.error('Error reading directory:', err);
//   }

//   return files;
// }



// enqueue but don't play
function enqueue(filePath) {
  console.log('Enqueueing:', filePath);
  playQueue.push(filePath);
  // Playback starts only via manual Play trigger
}

function parseTrackMetadata(filename) {
  const base = path.basename(filename, path.extname(filename)); // Remove extension
  const parts = base.split(' - '); // Expecting format: Artist - Title

  return {
    artist: parts.length > 1 ? parts[0].trim() : '',
    title: parts.length > 1 ? parts[1].trim() : base
  };
}

// playNext - starts playback or goes to next track


// function playNext() {
//   if (playQueue.length === 0) {
//     currentTrack = { title: 'No track playing', artist: '' };
//     return;
//   }

//   const nextFile = playQueue.shift();
//   const parsed = parseTrackMetadata(nextFile); // your logic here

//   currentTrack = {
//     title: parsed.title || path.basename(nextFile),
//     artist: parsed.artist || 'Unknown Artist'
//   };

//   // Start playback logic here...
// }

function playNext() {
  if (playQueue.length === 0) {
    nowPlaying = null;
    currentTrack = { title: 'No track playing', artist: '' }; // 🛠️ Clear currentTrack
    isPlaying = false;
    return;
  }

  lastPlaybackError = null;
  playbackStarted = false;
  nowPlaying = playQueue.shift();
  isPlaying = true;
  isPaused = false;

  // 🧠 Extract metadata from filename
  const parsed = parseTrackMetadata(nowPlaying); // You can define this function
  currentTrack = {
    title: parsed.title || path.basename(nowPlaying),
    artist: parsed.artist || 'Unknown Artist'
  };

  console.log('🎶 Now playing:', currentTrack);

  const fullPath = path.join(MUSIC_DIR, nowPlaying);
  currentProcess = spawn('mplayer', ['-slave', '-quiet', fullPath]);
  currentProcess.stdin.setEncoding('utf-8');

  currentProcess.stdout.on('data', data => {
    const output = data.toString();
    console.log('[MPlayer]', output);

    if (output.includes('Starting playback')) {
      playbackStarted = true;
    }
  });

  currentProcess.stderr.on('data', data => {
    const errorMsg = data.toString();
    console.error('🎧 MPlayer stderr:', errorMsg);
    lastPlaybackError = errorMsg;
  });

  setTimeout(() => {
    if (!playbackStarted) {
      lastPlaybackError = `No playback started within 5 seconds for ${nowPlaying}`;
      console.error('⏱️ Playback timeout:', lastPlaybackError);
    }
  }, 5000);

  currentProcess.on('exit', () => {
    currentProcess = null;
    isPlaying = false;
    playNext();
  });
}

// function playNext() {
//   if (playQueue.length === 0) {
//     nowPlaying = null;
//     isPlaying = false;
//     return;
//   }

//   lastPlaybackError = null;
//   playbackStarted = false;
//   nowPlaying = playQueue.shift();
//   isPlaying = true;
//   isPaused = false;

//   const fullPath = path.join(MUSIC_DIR, nowPlaying);
//   currentProcess = spawn('mplayer', ['-slave', '-quiet', fullPath]);
//   currentProcess.stdin.setEncoding('utf-8');

//   // Detect successful playback
//   currentProcess.stdout.on('data', data => {
//     const output = data.toString();
//     console.log('[MPlayer]', output);

//     if (output.includes('Starting playback')) {
//       playbackStarted = true;
//     }
//   });

//   // Stderr listener for any error
//   currentProcess.stderr.on('data', data => {
//     const errorMsg = data.toString();
//     console.error('🎧 MPlayer stderr:', errorMsg);
//     lastPlaybackError = errorMsg;
//   });

//   // Playback timeout handler
//   setTimeout(() => {
//     if (!playbackStarted) {
//       lastPlaybackError = `No playback started within 5 seconds for ${nowPlaying}`;
//       console.error('⏱️ Playback timeout:', lastPlaybackError);
//     }
//   }, 5000);

//   currentProcess.on('exit', () => {
//     currentProcess = null;
//     isPlaying = false;
//     playNext();
//   });
// }

// save playlist to server
/**
 * Saves a JSON playlist to the server with the given name.
 * @param {string} name - The filename (without extension).
 * @param {Array} playlist - The playlist data as a JSON array.
 */
function savePlaylist(name, playlist) {
  return new Promise((resolve, reject) => {
    if (!name || !Array.isArray(playlist)) {
      return reject(new Error('Invalid name or playlist'));
    }

    const dirPath = path.join(__dirname, 'playlists');
    const filePath = path.join(dirPath, `${name}.json`);

    // Ensure the playlists directory exists
    fs.mkdir(dirPath, { recursive: true }, (mkdirErr) => {
      if (mkdirErr) return reject(mkdirErr);

      // Write the playlist file
      fs.writeFile(filePath, JSON.stringify(playlist, null, 2), (writeErr) => {
        if (writeErr) return reject(writeErr);
        resolve();
      });
    });
  });
}

// load playlist
function loadPlaylist(name) {
  return new Promise((resolve, reject) => {
    const filePath = path.join(__dirname, 'playlists', `${name}.json`);

    fs.readFile(filePath, 'utf8', (err, data) => {
      if (err) return reject(err);

      try {
        const playlist = JSON.parse(data);
        resolve(playlist);
      } catch (parseErr) {
        reject(parseErr);
      }
    });
  });
}


// ****************************** END FUNCTIONS ********************************

// <><><><><><><><><><><><><><><><><><><><><><><><><><><><><><><><><><><><><><><><><><><><><><><><><><><><><><><><>

// ****************************** APP ROUTES ************************************
// stop playback of radio on switch etc
process.on('exit', () => {
  if (currentStreamProcess) currentStreamProcess.kill('SIGTERM');
});


// **********************************************get radio stations from JSON: ***************************************
app.get('/stations', (req, res) => {
  const filePath = path.join(__dirname, 'stations.json');
    fs.readFile(filePath, 'utf8', (err, data) => {
      if (err) return res.status(500).send({ error: 'Could not load stations' });
      console.log('Raw stations.json contents:', data); // New line
      try {
        const json = JSON.parse(data);
        res.json(json);
      } catch (parseErr) {
        console.error('JSON parse failed:', parseErr);
        res.status(500).send({ error: 'Invalid JSON' });
      }
});
  // fs.readFile(filePath, (err, data) => {
  //   if (err) return res.status(500).send({ error: 'Could not load stations' });
  //   res.json(JSON.parse(data));
  // });
});

// expose battery status
app.use((req, res, next) => {
  res.locals.battery = currentBattery;
  next();
});

app.use((req, res, next) => {
  res.locals.tempOutput = currentTemp;
  next();
});

// === Radio Route ===
app.get('/radio', (req, res) => {
  res.render('radio');
});

// === Volume Control Routes ===
app.post('/volume/up', (req, res) => {
  if (currentProcess) currentProcess.stdin.write('volume +10\n');
  res.redirect(req.get('Referer') || '/');
});

app.post('/volume/down', (req, res) => {
  if (currentProcess) currentProcess.stdin.write('volume -10\n');
  res.redirect(req.get('Referer') || '/');
});

// === Pause/Resume
app.get('/toggle-pause', (req, res) => {
  if (currentProcess) {
    currentProcess.stdin.write(isPaused ? 'pause\n' : 'pause\n'); // toggles either way
    isPaused = !isPaused;
    res.redirect(req.get('Referrer') || '/');
  } else {
    res.status(400).send('Nothing is playing');
  }
});

// error check endpoint
app.get('/local-playback-status', (req, res) => {
  res.json({
    status: isPlaying ? 'playing' : 'idle',
    track: nowPlaying,
    error: lastPlaybackError
  });
});

// playlist start
app.post('/play-queue', (req, res) => {
  const sessionQueue = req.session.queue || [];

  if (!isPlaying && sessionQueue.length > 0) {
    playQueue = [...sessionQueue];
    playNext();

    // Delay redirect to allow currentTrack to update
    setTimeout(() => {
      res.redirect('/music');
    }, 200); // 200ms gives playNext() time to update
  } else {
    res.redirect('/music');
  }
});

// get now playing
app.get('/now-playing', (req, res) => {
  res.json(currentTrack || { title: 'No track playing', artist: '' });
});

// get list of existing playlists
app.get('/playlist/list', (req, res) => {
  const dirPath = path.join(__dirname, 'playlists');

  fs.readdir(dirPath, (err, files) => {
    if (err) {
      console.error('Error reading playlists:', err);
      return res.status(500).json({ success: false, message: 'Failed to list playlists' });
    }

    const playlists = files
      .filter(file => file.endsWith('.json'))
      .map(file => file.replace('.json', ''));

    res.json({ success: true, playlists });
  });
});

// playlist save
// POST route to save playlist
app.post('/playlist/save', (req, res) => {
  const name = req.body.name;
  const playlist = req.session.queue || [];

  if (!name || typeof name !== 'string' || playlist.length === 0) {
    return res.status(400).send('Missing playlist name or empty queue');
  }

  savePlaylist(name, playlist)
    .then(() => res.sendStatus(200))
    .catch(err => {
      console.error('Save failed:', err);
      res.status(500).send('Failed to save playlist');
    });
  });

// load playlist
app.get('/load-playlist/:name', (req, res) => {
  const name = req.params.name;
  if (!name || typeof name !== 'string') {
    return res.status(400).json({ success: false, message: 'Invalid playlist name' });
  }

  loadPlaylist(name)
    .then(playlist => {
      if (!Array.isArray(playlist) || playlist.length === 0) {
        return res.status(404).json({ success: false, message: 'Playlist is empty or invalid' });
      }

      req.session.queue = playlist;
      res.json({ success: true });
    })
    .catch(err => {
      console.error('Error loading playlist:', err);
      res.status(500).json({ success: false, message: 'Failed to load playlist' });
    });
});

// === System Routes ===
app.post('/shutdown', (req, res) => {
  exec('sudo shutdown now', err => {
    if (err) return res.status(500).send('Shutdown failed');
    res.send('System is shutting down...');
  });
});

app.post('/reboot', (req, res) => {
  exec('sudo reboot', err => {
    if (err) return res.status(500).send('Reboot failed');
    res.send('System is rebooting...');
  });
});

app.get('/system', (req, res) => {
  exec('neofetch --stdout', (err, stdout) => {
    if (err) stdout = 'Error fetching system info.';
    res.render('system', { neofetchOutput: stdout });
  });
});

// === UI Routes ===
app.get('/', (req, res) => res.redirect('/menu'));
app.get('/menu', (req, res) => res.render('menu'));

app.get('/music', (req, res) => {
  const dir = req.query.dir || '';
  const entriesRaw = fs.readdirSync(path.join(MUSIC_DIR, dir), { withFileTypes: true });

  const entries = entriesRaw.map(entry => ({
    name: entry.name,
    isDir: entry.isDirectory(),
    relPath: path.join(dir, entry.name)
  }));

  const isTrackView = entries.every(entry => !entry.isDir);

  // const currentTrack = nowPlaying
  //   ? { artist: 'Unknown', title: nowPlaying }
  //   : { artist: 'None', title: 'No track playing' };
  let currentTrack = { title: 'No track playing', artist: '' };
  
  res.render('index', {
    entries,
    dir,
    isTrackView,
    currentTrack,
    queue: req.session.queue || [], // ✅ This line is critical
    tempOutput: req.session.tempOutput || '',
    playbackError: req.session.playbackError
  });
});

// back button in file browser
app.get('/music/up', (req, res) => {
  const currentRelDir = req.session.currentDir || ''; // e.g., 'rock/classics'
  const parts = currentRelDir.split(path.sep).filter(Boolean); // ['rock', 'classics']

  // Remove the last segment to go up one level
  parts.pop();
  const newRelDir = parts.join(path.sep); // e.g., 'rock'

  req.session.currentDir = newRelDir;

  const entries = getDirectoryView(newRelDir);
  const isTrackView = entries.every(e => e.isAudio);

  res.render('index', {
    entries,
    isTrackView,
    currentTrack: req.session.currentTrack || { title: 'No track playing', artist: '' },
    queue: req.session.queue || [],
    tempOutput: req.session.tempOutput || '',
    playbackError: req.session.playbackError
  });
});


// add to queue
app.get('/enqueue', (req, res) => {
  const file = req.query.file;
  if (!file) return res.status(400).send('Missing file param');

  const filePath = path.join(MUSIC_DIR, file);

  if (!filePath.startsWith(MUSIC_DIR) || !fs.existsSync(filePath)) {
    return res.status(400).send('Invalid file');
  }

  // Add to session queue
  if (!req.session.queue) {
    req.session.queue = [];
  }
  req.session.queue.push(file);

  // Enqueue for playback (your existing logic)
  enqueue(file);

  res.redirect('/music?dir=' + encodeURIComponent(path.dirname(file)));
});


app.post('/queue/remove/:index', (req, res) => {
  const idx = parseInt(req.params.index);
  if (!isNaN(idx) && idx >= 0 && idx < playQueue.length) {
    playQueue.splice(idx, 1);
  }
  res.redirect('/music');
});

app.post('/next-track', (req, res) => {
  if (currentProcess) currentProcess.kill();
  isPlaying = false;
  res.redirect('/music');
});

app.post('/prev-track', (req, res) => {
  if (nowPlaying) playQueue.unshift(nowPlaying);
  if (currentProcess) currentProcess.kill();
  isPlaying = false;
  res.redirect('/music');
});

// POST route updated with playback monitoring
app.post('/play-radio', express.json(), (req, res) => {
  const { stationName, stationURL } = req.body;

  if (currentStreamProcess) {
    currentStreamProcess.kill('SIGTERM');
    console.log(`🛑 Stopped previous stream`);
    streamStatus = 'idle';
  }

  currentStreamProcess = spawn('mplayer', ['-quiet', stationURL]);

  currentStreamProcess.stdout.on('data', data => {
    const output = data.toString();
    console.log('[MPlayer]', output);

    if (output.includes('Starting playback')) {
      streamStatus = 'playing';
      console.log(`🎶 ${stationName} is now playing`);
    }
  });

  currentStreamProcess.on('error', err => {
    console.error(`❌ MPlayer error for ${stationName}:`, err.message);
    streamStatus = 'error';
  });

  currentStreamProcess.on('exit', () => {
    console.log(`👋 Stream for ${stationName} ended`);
    streamStatus = 'idle';
  });

  res.sendStatus(200);
});

// ✅ Add a simple status endpoint
app.get('/stream-status', (req, res) => {
  res.json({ status: streamStatus });
});

app.post('/kill-radio', (req, res) => {
  if (currentStreamProcess) {
    currentStreamProcess.kill('SIGTERM');
    currentStreamProcess = null;
    streamStatus = 'idle';
    console.log('🛑 Playback killed via navigation');
  }
  res.sendStatus(200);
});

// ****************************** END APP ROUTES ********************************


// this calls the pi ups function on a given interval
setInterval(async () => {
  try {
    currentBattery = await getBatteryStatus();
    console.log(`🔋 Battery: ${currentBattery.powerStatus}, Voltage: ${currentBattery.volts.toFixed(2)}V`);
  } catch (err) {
    console.error('Battery status check failed:', err);
  }
}, 60000); // every 60 seconds

// 🌡️ System Temp
let currentTemp = 'Temp not available';
setInterval(() => {
  exec('vcgencmd measure_temp', (err, stdout) => {
    if (!err) currentTemp = stdout.trim();
  });
}, 60000);

// *************** Spotify Integration WIP ******************
const SpotifyWebApi = require('spotify-web-api-node');
const spotifyApi = new SpotifyWebApi({
  clientId: process.env.SPOTIFY_CLIENT_ID,
  clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
  redirectUri: process.env.SPOTIFY_REDIRECT_URI
});
// *************** END Spotify Integration WIP **************


// 🚀 Start HTTPS server
https.createServer(sslOptions, app).listen(PORT, () => {
  console.log(`🔒 Secure music server live at https://localhost:${PORT}`);
});
