// Core dependencies
const express = require('express');
const fs = require('fs');
const path = require('path');
const { spawn, exec } = require('child_process');
const https = require('https');
require('dotenv').config();

// ****************************** CONSTANTS ETC ************************************

const app = express();
const PORT = 3000;
const MUSIC_DIR = '/home/dietpi/Music';

// View engine and static files
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static('public'));

// SSL config
const sslOptions = {
  key: fs.readFileSync('server.key'),
  cert: fs.readFileSync('server.cert')
};

// be able to query the Pi UPS using ina219-async
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
function getDirectoryContents(relDir = '') {
  const dirPath = path.join(MUSIC_DIR, relDir);
  let files = [];

  function walk(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    entries.forEach(entry => {
      const fullPath = path.join(dir, entry.name);
      const relPath = path.relative(MUSIC_DIR, fullPath);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.name.match(/\.(mp3|flac|m4a)$/)) {
        files.push(relPath);
      }
    });
  }

  try {
    walk(dirPath);
  } catch (err) {
    console.error('Error reading directory:', err);
  }

  return files;
}
// enqueue but don't play
function enqueue(filePath) {
  console.log('Enqueueing:', filePath);
  playQueue.push(filePath);
  // Playback starts only via manual Play trigger
}

// playNext - starts playback or goes to next track
function playNext() {
  if (playQueue.length === 0) {
    nowPlaying = null;
    isPlaying = false;
    return;
  }

  lastPlaybackError = null;
  playbackStarted = false;
  nowPlaying = playQueue.shift();
  isPlaying = true;
  isPaused = false;

  const fullPath = path.join(MUSIC_DIR, nowPlaying);
  currentProcess = spawn('mplayer', ['-slave', '-quiet', fullPath]);
  currentProcess.stdin.setEncoding('utf-8');

  // Detect successful playback
  currentProcess.stdout.on('data', data => {
    const output = data.toString();
    console.log('[MPlayer]', output);

    if (output.includes('Starting playback')) {
      playbackStarted = true;
    }
  });

  // Stderr listener for any error
  currentProcess.stderr.on('data', data => {
    const errorMsg = data.toString();
    console.error('🎧 MPlayer stderr:', errorMsg);
    lastPlaybackError = errorMsg;
  });

  // Playback timeout handler
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



// ****************************** END FUNCTIONS ********************************

// <><><><><><><><><><><><><><><><><><><><><><><><><><><><><><><><><><><><><><><><><><><><><><><><><><><><><><><><>

// ****************************** APP ROUTES ************************************
// stop playback of radio on switch etc
process.on('exit', () => {
  if (currentStreamProcess) currentStreamProcess.kill('SIGTERM');
});


// get radio stations from JSON:
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
  if (!isPlaying && playQueue.length > 0) {
    playNext(); // manually initiate playback
  }
  res.redirect('/music');
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

  const currentTrack = nowPlaying
    ? { artist: 'Unknown', title: nowPlaying }
    : { artist: 'None', title: 'No track playing' };

  res.render('index', {
    entries,
    dir,
    isTrackView,
    queue: playQueue,
    currentTrack
  });
});

app.get('/enqueue', (req, res) => {
  const file = req.query.file;
  if (!file) return res.status(400).send('Missing file param');
  const filePath = path.join(MUSIC_DIR, file);

  if (!filePath.startsWith(MUSIC_DIR) || !fs.existsSync(filePath)) {
    return res.status(400).send('Invalid file');
  }

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
