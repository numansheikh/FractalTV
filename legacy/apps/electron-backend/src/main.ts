import { app, BrowserWindow } from 'electron';
import fixPath from 'fix-path';

// Prevent EPIPE from crashing the app when stdout/stderr pipe is closed
// (e.g. parent process or terminal disconnects but Electron keeps running)
function ignorePipeError(stream: NodeJS.WriteStream): void {
    if (stream && typeof stream.on === 'function') {
        stream.on('error', (err: NodeJS.ErrnoException) => {
            if (err?.code === 'EPIPE') return;
            throw err;
        });
    }
}
ignorePipeError(process.stdout);
ignorePipeError(process.stderr);
import App from './app/app';
import { initDatabase } from './app/database/connection';
import DatabaseEvents from './app/events/database.events';
import {
    resetStaleDownloads,
    setMainWindow as setDownloadsMainWindow,
} from './app/events/database/downloads.events';
import ElectronEvents from './app/events/electron.events';
import EpgEvents from './app/events/epg.events';
import PlayerEvents from './app/events/player.events';
import PlaylistEvents from './app/events/playlist.events';
import RemoteControlEvents from './app/events/remote-control.events';
import SettingsEvents from './app/events/settings.events';
import SharedEvents from './app/events/shared.events';
import SquirrelEvents from './app/events/squirrel.events';
import XtreamEvents from './app/events/xtream.events';

app.setName('fractals');

// Prevent multiple app instances (e.g. from serve:backend watch or double-launch)
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
    app.quit();
} else {
    app.on('second-instance', () => {
        if (App.mainWindow) {
            if (App.mainWindow.isMinimized()) App.mainWindow.restore();
            App.mainWindow.focus();
        }
    });
}

export default class Main {
    static initialize() {
        if (SquirrelEvents.handleEvents()) {
            // squirrel event handled (except first run event) and app will exit in 1000ms, so don't do anything else
            app.quit();
        }
    }

    static bootstrapApp() {
        App.main(app, BrowserWindow);
    }

    static async bootstrapAppEvents() {
        // Initialize database before other events
        await initDatabase();

        ElectronEvents.bootstrapElectronEvents();
        PlaylistEvents.bootstrapPlaylistEvents();
        SharedEvents.bootstrapSharedEvents();
        PlayerEvents.bootstrapPlayerEvents();
        SettingsEvents.bootstrapSettingsEvents();
        XtreamEvents.bootstrapXtreamEvents();
        DatabaseEvents.bootstrapDatabaseEvents();
        EpgEvents.bootstrapEpgEvents();
        RemoteControlEvents.bootstrapRemoteControlEvents();

        // Set main window for downloads and reset stale downloads
        if (App.mainWindow) {
            setDownloadsMainWindow(App.mainWindow);
        }
        await resetStaleDownloads();

        // initialize auto updater service
        if (!App.isDevelopmentMode()) {
            // UpdateEvents.initAutoUpdateService();
        }
    }
}

fixPath();

// handle setup events as quickly as possible
Main.initialize();

// bootstrap app
Main.bootstrapApp();

// Bootstrap app events after Electron app is ready
app.whenReady().then(async () => {
    await Main.bootstrapAppEvents();
});
