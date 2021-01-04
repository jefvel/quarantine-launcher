const { app, BrowserWindow, remote } = require('electron');
const electronDL = require('electron-dl');

const { spawn } = require('child_process');

const fetch = require('node-fetch');
const unzipper = require('unzipper');

const fs = require('fs');
const { exit } = require('process');
const {download} = electronDL;

const downloadURL = 'https://int.jefvel.net/~jefvel/gamemanifest';
const manifestFile = 'manifest.json';

let userDir;
let downloadDir;
let manifestPath;

function loadValues() {
    userDir = process.env.APPDATA || (process.platform == 'darwin' ? process.env.HOME + '/Library/Preferences' : process.env.HOME + "/.local/share");
    downloadDir = `${userDir}/karanten`;
    manifestPath = `${downloadDir}/${manifestFile}`;
    electronDL({
        directory: downloadDir,
    });
}



let win;
(async () => {
    await app.whenReady();
    win = new BrowserWindow({
        width: 800,
        height: 420,
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

        fetch(`${downloadURL}/${manifestFile}`, {method: 'get'})
        .then(res => res.json())
        .then(manifest => {
            readManifest(manifest);
        });
    });
})();

async function readManifest(manifest) {
    let rawdata = fs.writeFileSync(manifestPath, manifest);
    //let manifest = JSON.parse(rawdata);

    const zipFile = `${downloadDir}/${manifest.path}`;

    win.webContents.send('manifestInfo', manifest);

    if (!fs.existsSync(zipFile)){
        const result = await download(win, `${downloadURL}/versions/${manifest.path}`, {
            directory: downloadDir,
        });
    }


    const e = fs.createReadStream(zipFile)
    .pipe(unzipper.Extract({ path: `${downloadDir}/bin/latest`}));

    e.on("close", () => {
        gameReady = true;
        win.webContents.send('enableStart');
    });
};

let gameReady = false;

function launchGame() {
    if (!gameReady) {
        return;
    }

    spawn(`${downloadDir}/bin/latest/quarantine.exe`, [`${downloadDir}/bin/latest/hlboot.dat`], {
        cwd:`${downloadDir}`,
        detached: true,
    });

    exit();
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

const {ipcMain} = require('electron'); // include the ipc module to communicate with render process ie to receive the message from render process
 
//ipcMain.on will receive the “btnclick” info from renderprocess 
ipcMain.on("btnclick",function (event, arg) {
    launchGame();
});