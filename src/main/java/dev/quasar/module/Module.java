package dev.quasar.module;

import net.minecraft.client.MinecraftClient;

/** Base class for every feature that can be switched on and off in the click GUI. */
public abstract class Module {
    private final String name;
    private final String description;
    private final Category category;
    private boolean enabled;

    protected Module(String name, String description, Category category, boolean enabledByDefault) {
        this.name = name;
        this.description = description;
        this.category = category;
        this.enabled = enabledByDefault;
    }

    public final void toggle() {
        setEnabled(!enabled);
    }

    public final void setEnabled(boolean value) {
        if (value == enabled) return;
        enabled = value;
        if (value) onEnable();
        else onDisable();
    }

    protected void onEnable() {}

    protected void onDisable() {}

    /** Called at the end of every client tick (20x per second) while enabled. */
    public void onTick(MinecraftClient client) {}

    /** HUD-only modules are left out of the top-right module list. */
    public boolean showInModuleList() {
        return category != Category.HUD;
    }

    protected static MinecraftClient mc() {
        return MinecraftClient.getInstance();
    }

    public String getName() { return name; }
    public String getDescription() { return description; }
    public Category getCategory() { return category; }
    public boolean isEnabled() { return enabled; }
}
