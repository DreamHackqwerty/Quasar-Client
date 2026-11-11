# Quasar Client

A basic Minecraft client built as a Fabric mod for **Minecraft 1.21.1**.

## Features

| Key | Action |
| --- | --- |
| **Right Shift** | Open the click GUI (toggle modules, drag panels around) |
| **C** (hold) | Zoom 4x with smooth camera |

Both keys can be rebound in *Options → Controls → Key Binds → Quasar Client*.

**HUD** — Watermark, FPS, Coordinates + facing, Keystrokes (WASD, LMB/RMB with CPS, jump), Armor HUD, Module List
**Render** — Zoom, Fullbright
**Movement** — Toggle Sprint

The window title also changes to "Quasar Client 1.0.0 | Minecraft 1.21.1". Which modules are on is saved to `.minecraft/config/quasar-client.json`.

## Quasar Launcher (desktop app)

The `launcher/` folder is a desktop app with Home, Mods, Settings and Console pages.

```bash
cd "Quasar Client/launcher"
npm install      # once; needs Node.js 18+ (https://nodejs.org)
npm start
```

Pressing **Play**:

1. Builds the mod if `build/libs` has no jar yet (needs JDK 21)
2. Installs Fabric Loader 0.16.14 for 1.21.1 into your Minecraft folder
3. Downloads the latest Fabric API from Modrinth
4. Copies the Quasar mod and your Mods-page choices into a separate `minecraft/quasar` game folder
5. Adds a **Quasar Client** profile to the official Minecraft Launcher and opens it, so you sign in with your own Microsoft account as usual

Close the Minecraft Launcher before pressing Play the first time so it picks up the new profile.

### Starting Minecraft directly (no Minecraft Launcher)

Once you sign in under **Settings → Sign-in**, Play skips the Minecraft Launcher: Quasar downloads the game, its libraries, sounds and textures, and Mojang's Java 21 itself, then starts Minecraft with Quasar and your mods. The first launch downloads about 700 MB; after that it only checks the files. Game output appears in the Console page.

Quasar's own Azure app ID is built into `launcher/main.js` (`CLIENT_ID`), so players never set anything up: they press **Sign in with Microsoft**, log in on Microsoft's page, and the window closes by itself. Mojang has to approve that app ID once before sign-in works (requested through https://aka.ms/mce-reviewappid).

Until the app is approved, signing in reports that Mojang has not approved it yet, and Play keeps using the Minecraft Launcher. Your sign-in is stored encrypted with your computer's keychain and is never shown in the Console.
Run `npm run dist` to package the launcher as a .dmg / .exe installer (when packaged, choose the mod jar in Settings).

## Requirements

- **JDK 21** (e.g. `brew install openjdk@21`, or Temurin 21 from adoptium.net)
- Internet the first time you build (Gradle downloads Minecraft, Fabric and the mappings)

## Run it in a dev environment

```bash
cd "Quasar Client"
chmod +x gradlew        # only needed once
./gradlew runClient
```

The first run takes a few minutes. A Minecraft window opens with the client loaded.

## Build the mod jar

```bash
./gradlew build
```

The jar ends up in `build/libs/quasar-client-1.0.0.jar`. To play with it in the normal launcher:

1. Install the Fabric Loader for 1.21.1 from https://fabricmc.net/use/installer/
2. Put `quasar-client-1.0.0.jar` **and** Fabric API (1.21.1) into `.minecraft/mods/`
3. Start the "fabric-loader-1.21.1" profile

## Project layout

```
src/main/java/dev/quasar/
  QuasarClient.java        entry point: keybinds, tick loop, HUD hook
  Config.java              saves/loads module on/off state
  module/                  Module base class, categories, manager
    hud/ render/ movement/ the individual features
  gui/                     HUD layout, click GUI, colours
  mixin/                   zoom FOV, window title, brightness accessor
```

## Adding a module

1. Create a class extending `Module` (pick a `Category`, set a default on/off).
2. Override `onTick`, `onEnable` or `onDisable` as needed.
3. Register it in `ModuleManager.init()`. It shows up in the click GUI automatically.
