const { app, BrowserWindow, ipcMain } = require('electron');
const log = require('electron-log');
const { autoUpdater } = require("electron-updater")
const electronDL = require('electron-dl');

const { spawn } = require('child_process');

const fetch = require('node-fetch');
const unzipper = require('unzipper');

const fs = require('fs');
const os = require('os');

const { exit } = require('process');
const { download } = electronDL;

const downloadURL = 'https://int.jefvel.net/~jefvel/gamemanifest';
const manifestFile = 'manifest.json';

let userDir;
let appDir;
let manifestPath;

autoUpdater.logger = log;
autoUpdater.logger.transports.file.level = 'info';

function loadValues() {
    userDir = process.env.APPDATA || (process.platform == 'darwin' ? process.env.HOME + '/Library/Preferences' : process.env.HOME + "/.local/share");
    appDir = `${userDir}/karanten`;
    manifestPath = `${appDir}/${manifestFile}`;
    electronDL({
        directory: appDir,
    });
}

const launcherVersion = require('./package.json').version;

let win;
(async () => {
    await app.whenReady();
    win = new BrowserWindow({
        width: 800,
        height: 480,
        frame: false,
        maximizable: false,
        transparent: true,
        resizable: false,
        webPreferences: {
            nodeIntegration: true
        }
    });

    win.loadFile('index.html');

    win.webContents.on('did-finish-load', () => {
        loadValues();
        win.webContents.send('launcherVersion', launcherVersion);
        if (os.platform() === 'win32') {
            autoUpdater.checkForUpdatesAndNotify().then(r => {
                if (r == null) {
                    loadManifestFile();
                }
                else {
                    console.log(r);
                }
            });
        } else {
            loadManifestFile();
        }
    });
})();

let loadingManifest = false;
async function loadManifestFile() {
    if (loadingManifest) {
        return;
    }

    loadingManifest = true;

    readManifest();
}

let currentManifest = null;

let oldManifest = null;

function loadOldManifest() {
    const defaultManifest = {
        runtimeVersion: null,
        gameVersion: null,
        gamePath: null,
        runtimePath: null,
    };

    if (fs.existsSync(manifestPath)) {
        const oldManifestString = fs.readFileSync(manifestPath);

        try {
            oldManifest = JSON.parse(oldManifestString);
        } catch(e) {
            oldManifest = defaultManifest;
        }
    } else {
        oldManifest = defaultManifest;
    }
}

const bintrayAPI = 'https://api.bintray.com/packages/jefvel/karanten';
const bintrayDLURL = 'https://dl.bintray.com/jefvel/karanten';

function getRuntimeName() {
    switch(os.platform()) {
        case 'darwin': return 'runtime-mac';
        case 'win32': return 'runtime-win';
        case 'linux': return 'runtime-linux';
        default: return 'runtime-win';
    }
}

async function readManifest() {
    loadOldManifest();

    let manifest = {...oldManifest};

    const runtimeName = getRuntimeName();
    const gameName = 'data';

    sendStatusToWindow("Checking Game Version...");
    const runtimeVersion = (await fetch(`${bintrayAPI}/${runtimeName}/versions/_latest`, { method: 'get' })
        .then(res => res.json())).name;
    if (oldManifest.runtimeVersion !== runtimeVersion) {
        const runtimeInfo = (await fetch(`${bintrayAPI}/${runtimeName}/versions/${runtimeVersion}/files`, { method: 'get' })
            .then(res => res.json()))[0];

        manifest.runtimeVersion = runtimeInfo.version;
        manifest.runtimePath = runtimeInfo.path;
    }

    const gameVersion = (await fetch(`${bintrayAPI}/${gameName}/versions/_latest`, { method: 'get' })
        .then(res => res.json())).name;
    
    if (oldManifest.gameVersion !== gameVersion) {
        const gameInfo = (await fetch(`${bintrayAPI}/${gameName}/versions/${gameVersion}/files`, { method: 'get' })
            .then(res => res.json()))[0];

        manifest.gameVersion = gameInfo.version;
        manifest.gamePath = gameInfo.path;
    }

    win.webContents.send('manifestInfo', manifest);

    currentManifest = manifest;

    const gameZipFile = `${appDir}/${manifest.gamePath}`;
    const runtimeFile = `${appDir}/${manifest.runtimePath}`;

    if (oldManifest.runtimeVersion !== manifest.runtimeVersion) {
        if (!fs.existsSync(runtimeFile)) {
            sendStatusToWindow('Downloading Runtime Files');

            //`${downloadURL}/runtimes/${platform}/${manifest.runtime}`
            const dlURL = `${bintrayDLURL}/${manifest.runtimePath}`;

            await download(win, dlURL, {
                onProgress: p => {
                    win.webContents.send('setProgress', p.percent);
                },
                directory: `${appDir}`,
            });
        }

        sendStatusToWindow('Extracting Runtime');
        const e = fs.createReadStream(runtimeFile)
            .pipe(unzipper.Extract({ path: `${appDir}/bin` }));

        let p = new Promise((resolve) => {
            e.on("close", () => {
                fs.unlinkSync(runtimeFile);
                resolve();
            })
        });

        await p.then;
    }

    if (oldManifest.gameVersion !== manifest.gameVersion) {
        if (!fs.existsSync(gameZipFile)) {
            sendStatusToWindow('Downloading Game Files');
            const dlURL = `${bintrayDLURL}/${manifest.gamePath}`;
            await download(win, dlURL, {
                onProgress: p => {
                    win.webContents.send('setProgress', p.percent);
                },
                directory: appDir,
            });
        }

        sendStatusToWindow('Extracting Game');
        const e = fs.createReadStream(gameZipFile)
            .pipe(unzipper.Extract({ path: `${appDir}/bin` }));

        let p = new Promise((resolve) => {
            e.on("close", () => {
                const exeFile = `${appDir}/bin/quarantine`;
                const platform = os.platform();
                
                if (platform === 'darwin' || platform === 'linux') {
                    fs.chmodSync(exeFile, '755');
                }

                fs.unlinkSync(gameZipFile);
                resolve();
            })
        });

        await p.then;
    }

    fs.writeFileSync(manifestPath, JSON.stringify(manifest));

    gameReady();
};

let canLaunch = false;
function gameReady() {
    canLaunch = true;
    win.webContents.send('enableStart');
    sendStatusToWindow('Game Ready');
}

let launched = false;
function launchGame() {
    if (!canLaunch || launched) {
        return;
    }
    
    launched = true;

    const exeDir = `${appDir}/bin`;

    const child = spawn(`${exeDir}/quarantine`, [`${exeDir}/hlboot.dat`], {
        cwd: `${appDir}`,
    });

    win.hide();

    child.on('exit', () => {
        exit();
    });
}

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit()
    }
})

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow()
    }
})

ipcMain.on("launchGame", function (event, arg) {
    launchGame();
});

ipcMain.on("closeLauncher", function (event, arg) {
    exit();
});

function sendStatusToWindow(text) {
  log.info(text);
  win.webContents.send('message', text);
}

autoUpdater.on('checking-for-update', () => {
  sendStatusToWindow('Checking for launcher update...');
})

autoUpdater.on('update-available', (info) => {
  sendStatusToWindow('Update available. Downloading...');
})

autoUpdater.on('update-not-available', (info) => {
  sendStatusToWindow('Launcher is up to date');
  loadManifestFile();
})

autoUpdater.on('error', (err) => {
  sendStatusToWindow('Error in auto-updater. ' + err);
})

autoUpdater.on('download-progress', (progressObj) => {
    win.webContents.send('setProgress', progressObj.percent / 100.0);
});

autoUpdater.on('update-downloaded', (info) => {
  sendStatusToWindow('Update downloaded. Installing...');
  autoUpdater.quitAndInstall();
});
