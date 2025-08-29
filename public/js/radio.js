fetch('/stations')
  .then(res => res.json())
  .then(data => {
    const listEl = document.getElementById('station-list');
    const player = document.getElementById('stream-player');
    const status = document.getElementById('player-status');

    Object.entries(data).forEach(([id, { stationName, stationURL }]) => {
      const item = document.createElement('li');
      const btn = document.createElement('button');
      btn.textContent = `Play ${stationName}`;

        btn.onclick = () => {
          status.textContent = `Buffering ${stationName}...`;

          fetch('/play-radio', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ stationName, stationURL })
          })
            .then(res => {
              if (!res.ok) throw new Error('Playback failed');

              // Poll for real-time status
              const checkStatus = setInterval(() => {
                fetch('/stream-status')
                  .then(res => res.json())
                  .then(({ status: streamStatus }) => {
                    if (streamStatus === 'playing') {
                      status.textContent = `Playing ${stationName}`;
                      document.getElementById('current-station').textContent = stationName;

                      pauseBtn.disabled = false;
                      resumeBtn.disabled = true;

                      clearInterval(checkStatus);
                    } else if (streamStatus === 'error') {
                      status.textContent = `Error starting ${stationName}`;
                      clearInterval(checkStatus);
                    }
                  });
              }, 1000); // check every second
            })
            .catch(err => {
              status.textContent = `Error starting ${stationName}`;
              console.error(err);
            });
        };



      item.appendChild(btn);
      listEl.appendChild(item);
    });
  })
  .catch(err => {
    console.error('Failed to load stations:', err);
  });
const pauseBtn = document.getElementById('pause-btn');
const resumeBtn = document.getElementById('resume-btn');

pauseBtn.onclick = () => {
  fetch('/toggle-pause')
    .then(() => {
      status.textContent = 'Paused';
      pauseBtn.disabled = true;
      resumeBtn.disabled = false;
    })
    .catch(err => console.error('Pause failed:', err));
};

resumeBtn.onclick = () => {
  fetch('/toggle-pause')
    .then(() => {
      status.textContent = `Playing ${document.getElementById('current-station').textContent}`;
      resumeBtn.disabled = true;
      pauseBtn.disabled = false;
    })
    .catch(err => console.error('Resume failed:', err));
};

window.addEventListener('beforeunload', () => {
  fetch('/kill-radio', { method: 'POST' });
});

window.addEventListener('pageshow', e => {
  if (e.persisted) {
    fetch('/kill-radio', { method: 'POST' });
  }
});

const statusEl = document.getElementById('player-status');

window.addEventListener('load', () => {
  fetch('/stream-status')
    .then(res => res.json())
    .then(({ status }) => {
      if (status === 'playing') {
        statusEl.textContent = `Playing ${document.getElementById('current-station').textContent || 'Radio'}`;
        pauseBtn.disabled = false;
        resumeBtn.disabled = true;
      } else {
        statusEl.textContent = 'Stopped';
        pauseBtn.disabled = true;
        resumeBtn.disabled = true;
      }
    })
    .catch(err => console.error('Stream status fetch failed:', err));
});


