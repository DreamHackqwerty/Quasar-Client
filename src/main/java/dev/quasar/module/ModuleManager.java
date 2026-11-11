package dev.quasar.module;

import dev.quasar.module.hud.ArmorHud;
import dev.quasar.module.hud.Coordinates;
import dev.quasar.module.hud.FpsDisplay;
import dev.quasar.module.hud.Keystrokes;
import dev.quasar.module.hud.ModuleList;
import dev.quasar.module.hud.Watermark;
import dev.quasar.module.movement.ToggleSprint;
import dev.quasar.module.render.Fullbright;
import dev.quasar.module.render.Zoom;

import java.util.ArrayList;
import java.util.Collection;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public final class ModuleManager {
    private static final Map<Class<? extends Module>, Module> MODULES = new LinkedHashMap<>();

    private ModuleManager() {}

    public static void init() {
        // HUD
        add(new Watermark());
        add(new ModuleList());
        add(new FpsDisplay());
        add(new Coordinates());
        add(new Keystrokes());
        add(new ArmorHud());
        // Render
        add(new Zoom());
        add(new Fullbright());
        // Movement
        add(new ToggleSprint());
    }

    private static void add(Module module) {
        MODULES.put(module.getClass(), module);
    }

    @SuppressWarnings("unchecked")
    public static <T extends Module> T get(Class<T> type) {
        return (T) MODULES.get(type);
    }

    public static boolean isOn(Class<? extends Module> type) {
        Module module = MODULES.get(type);
        return module != null && module.isEnabled();
    }

    public static Collection<Module> all() {
        return Collections.unmodifiableCollection(MODULES.values());
    }

    public static List<Module> byCategory(Category category) {
        List<Module> list = new ArrayList<>();
        for (Module module : MODULES.values()) {
            if (module.getCategory() == category) list.add(module);
        }
        return list;
    }
}
