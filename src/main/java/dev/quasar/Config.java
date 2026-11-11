package dev.quasar;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import dev.quasar.module.Module;
import dev.quasar.module.ModuleManager;
import net.fabricmc.loader.api.FabricLoader;

import java.nio.file.Files;
import java.nio.file.Path;

/** Saves which modules are on/off to .minecraft/config/quasar-client.json. */
public final class Config {
    private static final Path FILE = FabricLoader.getInstance().getConfigDir().resolve("quasar-client.json");
    private static final Gson GSON = new GsonBuilder().setPrettyPrinting().create();

    private Config() {}

    public static void load() {
        if (!Files.exists(FILE)) return;
        try {
            JsonObject root = JsonParser.parseString(Files.readString(FILE)).getAsJsonObject();
            JsonObject modules = root.getAsJsonObject("modules");
            if (modules == null) return;
            for (Module module : ModuleManager.all()) {
                JsonElement value = modules.get(module.getName());
                if (value != null) module.setEnabled(value.getAsBoolean());
            }
        } catch (Exception e) {
            QuasarClient.LOG.error("Could not read {}", FILE, e);
        }
    }

    public static void save() {
        JsonObject modules = new JsonObject();
        for (Module module : ModuleManager.all()) {
            modules.addProperty(module.getName(), module.isEnabled());
        }
        JsonObject root = new JsonObject();
        root.add("modules", modules);
        try {
            Files.createDirectories(FILE.getParent());
            Files.writeString(FILE, GSON.toJson(root));
        } catch (Exception e) {
            QuasarClient.LOG.error("Could not write {}", FILE, e);
        }
    }
}
