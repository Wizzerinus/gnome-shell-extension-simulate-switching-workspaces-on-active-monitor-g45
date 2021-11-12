const Gio = imports.gi.Gio;
const Clutter = imports.gi.Clutter;
const GLib = imports.gi.GLib;
const St = imports.gi.St;
const Meta = imports.gi.Meta;
const Shell = imports.gi.Shell;
const Mainloop = imports.mainloop;
const GObject = imports.gi.GObject;

const Gettext = imports.gettext.domain("gnome-shell-extensions");
const _ = Gettext.gettext;

const Main = imports.ui.main;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;
const Slider = imports.ui.slider;

const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();

const SCHEMA =
  "org.gnome.shell.extensions.simulate-switching-workspaces-on-active-monitor";
const HOTKEY_NEXT = "switch-to-next-workspace-on-active-monitor";
const HOTKEY_PREVIOUS = "switch-to-previous-workspace-on-active-monitor";

const UP = -1;
const DOWN = 1;

const DEBUG_ACTIVE = true;

class WindowWrapper {
  constructor(windowActor, monitorIndex, workspaceIndex) {
    this.windowActor = windowActor;
    this.metaWindow = this.windowActor.get_meta_window();
    this.windowType = this.metaWindow.get_window_type();
    this.initialMonitorIndex = this.getMonitorIndex();
    this.initialWorkspaceIndex = this.getWorkspaceIndex();
  }

  getTitle() {
    return this.metaWindow.get_title();
  }

  getWorkspaceIndex() {
    return this.metaWindow.get_workspace().index();
  }

  getMonitorIndex() {
    return this.metaWindow.get_monitor();
  }

  toString() {
    return `
            title: ${this.getTitle()}
            windowType: ${this.windowType}
            monitorIndex: ${this.getMonitorIndex()}
            workspaceIndex: ${this.getWorkspaceIndex()}
            isNormal: ${this.isNormal()}
            `;
  }

  isNormal() {
    return this.windowType === Meta.WindowType.NORMAL;
  }

  moveToWorkSpace(nextIndex) {
    this.metaWindow.change_workspace_by_index(nextIndex, false);
  }
}

class WorkSpacesService {
  constructor(_configurationService) {
    this._configurationService = _configurationService;
    this._initNWorskpaces();
    this._activeWorkspaceIndex =
      global.workspace_manager.get_active_workspace_index();
    this._monitorActivatedWithFocus=null;
  }

  _initNWorskpaces() {
    this._nWorkspaces = global.workspace_manager.get_n_workspaces();
    maybeLog(`  workspacesService.nWorkspaces: ${this._nWorkspaces} `);
  }

  _moveToDirection(windowWrapper, direction) {
    let nextWorkspace =
      (this._nWorkspaces + windowWrapper.getWorkspaceIndex() + direction) %
      this._nWorkspaces;
    maybeLog(`next workspace will be ${nextWorkspace}`);
    windowWrapper.moveToWorkSpace(nextWorkspace);
  }

  windowActivatedWithFocus(window) {
    let monitor = window.get_monitor();
    log(`next active monitor will be ${monitor}`)
    this._monitorActivatedWithFocus = monitor;
  }

  switchToPreviouslyActiveWorkspaceOnInactiveMonitors() {
    if (!this._configurationService.automaticSwitchingIsEnabled()) {
      maybeLog(
        `not switching to previously active workspace because automaticSwitching is disabled`
      );
      return 
    }

    this._initNWorskpaces();

    const nextWorkspace = global.workspace_manager.get_active_workspace_index();
    const direction = nextWorkspace > this._activeWorkspaceIndex ? DOWN : UP;
    const diff =
      nextWorkspace > this._activeWorkspaceIndex
        ? nextWorkspace - this._activeWorkspaceIndex
        : this._activeWorkspaceIndex - nextWorkspace;
    const shift = direction * diff;

    const focusedMonitorIndex = this._monitorActivatedWithFocus != null
        ? this._monitorActivatedWithFocus
        : this._getFocusedMonitor();

    this._monitorActivatedWithFocus = null
    this._activeWorkspaceIndex = nextWorkspace;

    maybeLog(` workspaceChanged
        direction: ${direction}
        diff: ${diff}
        activeMonitor: ${focusedMonitorIndex}
    `);

    this._getWindowWrappers()
      .filter((it) => it.isNormal())
      .filter((it) => it.initialMonitorIndex != focusedMonitorIndex)
      .forEach((it) => {
        this._moveToDirection(it, shift);
      });

    maybeLog("moved some windows around");
  }

  switchWorkspaceOnActiveMonitor(direction) {
    maybeLog("begin  switchActiveWorkspace");

    this._initNWorskpaces();

    let wrappers = this._getWindowWrappers();

    maybeLog(`  got ${wrappers.length} windows`);
    wrappers.forEach((it) => {
      maybeLog(it.toString());
    });

    let focusedMonitorIndex = this._getFocusedMonitor();

    let windowsToMove = wrappers
      .filter((it) => it.isNormal())
      .filter((it) => it.initialMonitorIndex === focusedMonitorIndex);

    maybeLog(" those windows will be moved: ");
    windowsToMove.forEach((it) => {
      maybeLog(it.toString());
    });

    windowsToMove.forEach((it) => this._moveToDirection(it, direction));
  }

  _getWindowWrappers() {
    return global.get_window_actors().map((x) => new WindowWrapper(x, x, x));
  }

  _getFocusedMonitor() {
    return global.display.get_current_monitor();
  }
}

class Controller {
  constructor(workspaceService) {
    this._workspaceService = workspaceService;
    this._gsettings = ExtensionUtils.getSettings(SCHEMA);
  }

  up() {
    this._workspaceService.switchWorkspaceOnActiveMonitor(UP);
  }

  down() {
    this._workspaceService.switchWorkspaceOnActiveMonitor(DOWN);
  }
}

class ConfigurationService {
  _incompatibleExtensions = [
    "dash-to-dock@micxgx.gmail.com",
    "ubuntu-dock@ubuntu.com",
  ];

  constructor() {
    this.conditionallyEnableAutomaticSwitching();
  }

  conditionallyEnableAutomaticSwitching() {

    this._anIncompatibleExtensionIsActive =
      this._incompatibleExtensions.some((it) => {
        let extension = imports.ui.main.extensionManager.lookup(it)
        return (extension && extension.state == ExtensionUtils.ExtensionState.ENABLED)
      });

    this._dynamicWorspaces = Meta.prefs_get_dynamic_workspaces();
  }

  automaticSwitchingIsEnabled() {
    return true
    //return !this._anIncompatibleExtensionIsActive && !this._dynamicWorspaces;
  }

  toString() {
   return `
      anIncompatibleExtensionIsActive: ${this._anIncompatibleExtensionIsActive} 
      dynamicWorspaces: ${this._dynamicWorspaces}`
  }
}

function addKeybinding() {
  let modeType = Shell.ActionMode.ALL;

  Main.wm.addKeybinding(
    HOTKEY_NEXT,
    controller._gsettings,
    Meta.KeyBindingFlags.NONE,
    modeType,
    controller.up.bind(controller)
  );

  Main.wm.addKeybinding(
    HOTKEY_PREVIOUS,
    controller._gsettings,
    Meta.KeyBindingFlags.NONE,
    modeType,
    controller.down.bind(controller)
  );
}

function removeKeybinding() {
  Main.wm.removeKeybinding(HOTKEY_NEXT);
  Main.wm.removeKeybinding(HOTKEY_PREVIOUS);
}

let controller;
let workspaceService;
let configurationService;
let workSpaceChangedListener;
let originalActivateWithFocus

function onWorkspaceChanged() {
  workspaceService.switchToPreviouslyActiveWorkspaceOnInactiveMonitors();
}

function onExtensionStateChanged(extension,state) {

  maybeLog (`an extension state changed ${extension.uid}, ${state.state}`)
  configurationService.conditionallyEnableAutomaticSwitching();
  maybeLog (configurationService.toString())
}

function activateWithFocus (window, timestamp) {
  log(`in overridden activate_with_focus`)

  workspaceService.windowActivatedWithFocus(window)
  return originalActivateWithFocus.call(this, window, timestamp);
}

function enable() {

  originalActivateWithFocus = Meta.Workspace.prototype.activate_with_focus;
  Meta.Workspace.prototype.activate_with_focus = activateWithFocus


  configurationService = new ConfigurationService();
  workspaceService = new WorkSpacesService(configurationService);
  controller = new Controller(workspaceService);
  workSpaceChangedListener = global.workspace_manager.connect(
    "active-workspace-changed",
    onWorkspaceChanged
  );

  extensionStateChangedListener = Main.extensionManager.connect(
    "extension-state-changed",
    onExtensionStateChanged
  );



  addKeybinding();

  maybeLog(configurationService.toString())
}

function disable() {
  removeKeybinding();
  if (workSpaceChangedListener) {
    global.workspace_manager.disconnect(workSpaceChangedListener);
  }
  if (extensionStateChangedListener) {
    global.workspace_manager.disconnect(extensionStateChangedListener);
  }

  if (originalActivateWithFocus) {
    Meta.Workspace.prototype.activate_with_focus = originalActivateWithFocus
  }

  workSpaceChangedListener = null;
  extensionStateChangedListener = null;
  controller = null;
  workspaceService = null;
}

function maybeLog(value) {
  if (DEBUG_ACTIVE) {
    log(value);
  }
}
