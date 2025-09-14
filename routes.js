// routes.js
// all app routes live here
// code cleanup 14/09/25

const express = require('express');
const path = require('path');
const fs = require('fs');

const router = express.Router();

const {
  currentBattery,
  playQueue,
  nowPlaying,
  isPlaying,
  enqueue,
  playNext,
  savePlaylist,
  loadPlaylist,
  getDirectoryView
} = require('./index'); // Adjust path as needed

// ****************************** APP ROUTES ************************************
// stop playback of radio on switch etc
process.on('exit', () => {
  if (currentStreamProcess) currentStreamProcess.kill('SIGTERM');
});


// **********************************************get radio stations from JSON: ***************************************
router.get('/stations', (req, res) => {
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
router.use((req, res, next) => {
  res.locals.battery = currentBattery;
  next();
});

router.use((req, res, next) => {
  res.locals.tempOutput = currentTemp;
  next();
});

// === Radio Route ===
router.get('/radio', (req, res) => {
  res.render('radio');
});

// === Volume Control Routes ===
router.post('/volume/up', (req, res) => {
  if (currentProcess) currentProcess.stdin.write('volume +10\n');
  res.redirect(req.get('Referer') || '/');
});

router.post('/volume/down', (req, res) => {
  if (currentProcess) currentProcess.stdin.write('volume -10\n');
  res.redirect(req.get('Referer') || '/');
});

// === Pause/Resume
router.get('/toggle-pause', (req, res) => {
  if (currentProcess) {
    currentProcess.stdin.write(isPaused ? 'pause\n' : 'pause\n'); // toggles either way
    isPaused = !isPaused;
    res.redirect(req.get('Referrer') || '/');
  } else {
    res.status(400).send('Nothing is playing');
  }
});

// error check endpoint
router.get('/local-playback-status', (req, res) => {
  res.json({
    status: isPlaying ? 'playing' : 'idle',
    track: nowPlaying,
    error: lastPlaybackError
  });
});

// playlist start
router.post('/play-queue', (req, res) => {
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
router.get('/now-playing', (req, res) => {
  res.json(currentTrack || { title: 'No track playing', artist: '' });
});

// get list of existing playlists
router.get('/playlist/list', (req, res) => {
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
router.post('/playlist/save', (req, res) => {
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
router.get('/load-playlist/:name', (req, res) => {
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
router.post('/shutdown', (req, res) => {
  exec('sudo shutdown now', err => {
    if (err) return res.status(500).send('Shutdown failed');
    res.send('System is shutting down...');
  });
});

router.post('/reboot', (req, res) => {
  exec('sudo reboot', err => {
    if (err) return res.status(500).send('Reboot failed');
    res.send('System is rebooting...');
  });
});

router.get('/system', (req, res) => {
  exec('neofetch --stdout', (err, stdout) => {
    if (err) stdout = 'Error fetching system info.';
    res.render('system', { neofetchOutput: stdout });
  });
});

// === UI Routes ===
router.get('/', (req, res) => res.redirect('/menu'));
router.get('/menu', (req, res) => res.render('menu'));

router.get('/music', (req, res) => {
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
router.get('/music/up', (req, res) => {
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
router.get('/enqueue', (req, res) => {
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
  res.json({ success: true, track: file }); // Respond with success
});


router.post('/queue/remove/:index', (req, res) => {
  const idx = parseInt(req.params.index);
  if (!isNaN(idx) && idx >= 0 && idx < playQueue.length) {
    playQueue.splice(idx, 1);
  }
  res.redirect('/music');
});

router.post('/next-track', (req, res) => {
  if (currentProcess) currentProcess.kill();
  isPlaying = false;
  res.redirect('/music');
});

router.post('/prev-track', (req, res) => {
  if (nowPlaying) playQueue.unshift(nowPlaying);
  if (currentProcess) currentProcess.kill();
  isPlaying = false;
  res.redirect('/music');
});

// POST route updated with playback monitoring
router.post('/play-radio', express.json(), (req, res) => {
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
router.get('/stream-status', (req, res) => {
  res.json({ status: streamStatus });
});

router.post('/kill-radio', (req, res) => {
  if (currentStreamProcess) {
    currentStreamProcess.kill('SIGTERM');
    currentStreamProcess = null;
    streamStatus = 'idle';
    console.log('🛑 Playback killed via navigation');
  }
  res.sendStatus(200);
});

// ****************************** END APP ROUTES ********************************

//export so we can use it.
module.exports = router;