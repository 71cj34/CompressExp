// main.js
const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const { spawn } = require('child_process');
const path = require('path');

const createWindow = () => {
  const win = new BrowserWindow({
    width: 600,
    height: 600,
    webPreferences: {
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  win.loadFile('index.html');
  // win.webContents.openDevTools(); // Open DevTools
};

app.whenReady().then(() => {
  const mainMenu = Menu.buildFromTemplate([]);
  Menu.setApplicationMenu(mainMenu);
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

async function getVideoDuration(inputPath) {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn(`"./ffmpeg/ffmpeg.exe"`, ['-i', `"${inputPath}"`], { shell: true });

    ffmpeg.stderr.on('data', (data) => {
      const output = data.toString();
      console.log('FFmpeg stderr:', output); // Debugging statement
      const match = output.match(/Duration:\s+(\d+):(\d+):(\d+\.\d+)/);
      if (match) {
        const hours = parseInt(match[1], 10);
        const minutes = parseInt(match[2], 10);
        const seconds = parseFloat(match[3]);
        const totalDuration = hours * 3600 + minutes * 60 + seconds;
        console.log('Total duration:', totalDuration); // Debugging statement
        resolve(totalDuration);
      }
    });

    ffmpeg.on('close', (code) => {
      if (code !== 0) {
        console.error('Failed to get video duration'); // Debugging statement
        reject(new Error('Failed to get video duration'));
      }
    });

    ffmpeg.on('error', (error) => {
      console.error('Error getting video duration:', error); // Debugging statement
      reject(error);
    });
  });
}

function parseTime(timeStr) {
  const [hours, minutes, seconds] = timeStr.split(':').map(parseFloat);
  return hours * 3600 + minutes * 60 + seconds;
}

ipcMain.on('start-process', async (event, options) => {
  console.log('Received options:', options);

  if (options) {
    const { inputVideo, crf, codec, speed, tune, preoutputName } = options;

    let inputPath = inputVideo;
    let crfValue = Math.round((crf**3)/3 - 3.3*crf**2 + ((37*crf)/3)+11);
    let codecValue = codec === '1' ? 'libx264' : 'libx265';
    let speedValue = ['ultrafast', 'veryfast', 'fast', 'medium', 'slow', 'slower', 'veryslow'][speed - 1];
    let tuneValue = ['film', 'animation', 'grain', 'stillimage', 'fastdecode', 'zerolatency', 'none'][tune - 1];
    let outputName;

    if (preoutputName.slice(-4) !== ".mp4" || preoutputName.length < 4) {
      outputName = preoutputName + ".mp4";
    } else {
      outputName = preoutputName;
    }

    let tuneCommand = tuneValue === 'none' ? "" : `-tune ${tuneValue}`;

    const outputDir = path.dirname(inputPath);
    const outputPath = path.join(outputDir, outputName);

    console.log('User choices:', {
      inputPath,
      crfValue,
      codecValue,
      speedValue,
      tuneCommand,
      outputPath
    });

    const h264Params = " -aq-mode 2 -aq-strength 1.0 -b-adapt 2 -me umh -subme 8 -psy-rd 1.0:0.15 -ref 5 ";
    const h265Params = ' -x265-params "ctu=64:rd=3:ref=3:aq-mode=3" ';
    let libParams = codecValue === 'libx264' ? h264Params : h265Params;

    try {
      const totalDuration = await getVideoDuration(inputPath);
      console.log(`Total duration: ${totalDuration} seconds`); // Debugging statement

      const command = `"./ffmpeg/ffmpeg.exe" -i "${inputPath}" -vcodec ${codecValue} -crf ${crfValue} ${tuneCommand} -progress - -preset ${speedValue} ${libParams} "${outputPath}"`;
      console.log('FFmpeg command:', command); // Debugging statement

      const ffmpeg = spawn(command, { shell: true });

      ffmpeg.stderr.on('data', (data) => {
        const output = data.toString();
        console.log('FFmpeg stderr:', output); // Debugging statement

        const match = output.match(/frame=\s*(\d+)\s+fps=\s*(\d+)\s+q=\s*(\d+(\.\d+)?)\s+size=\s*(\d+)\s*(Ki?B)\s+time=\s*(\d+:\d+:\d+\.\d+)\s+bitrate=\s*(\d+(\.\d+)?)\s*kbits\/s\s+speed=\s*(\d+(\.\d+)?)x/);
        if (match) {
          const size = parseInt(match[5], 10);
          const timeStr = match[7];
          const currentTime = parseTime(timeStr);
          const progress = (currentTime / totalDuration) * 100;
          console.log(`Progress: ${progress.toFixed(2)}, Size: ${size} KB`); // Debugging statement

          const eventData = { progress, size };
          console.log('Sending ffmpeg-progress event with data:', eventData); // Additional debugging statement

          event.reply('ffmpeg-progress', eventData);
        }
      });

      ffmpeg.on('close', (code) => {
        console.log(`FFmpeg process exited with code ${code}`); // Debugging statement
        event.reply('ffmpeg-complete');
      });

      ffmpeg.on('error', (error) => {
        console.error(`Error: ${error.message}`); // Debugging statement
        event.reply('ffmpeg-error', { error: error.message });
      });
    } catch (error) {
      console.error('Error getting video duration:', error); // Debugging statement
      event.reply('ffmpeg-error', { error: error.message });
    }
  } else {
    console.error('No options received'); // Debugging statement
  }
});

ipcMain.handle('open-file-dialog', async (event) => {
  const result = await dialog.showOpenDialog({ properties: ['openFile'] });
  if (result.canceled) {
    return null;
  }
  return result.filePaths[0];
});
