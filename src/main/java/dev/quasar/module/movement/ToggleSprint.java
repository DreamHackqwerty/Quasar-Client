package dev.quasar.module.movement;

import dev.quasar.module.Category;
import dev.quasar.module.Module;
import net.minecraft.client.MinecraftClient;

/** Keeps the sprint key held so you sprint whenever you walk forward. */
public final class ToggleSprint extends Module {
    public ToggleSprint() {
        super("Toggle Sprint", "Always sprint when moving forward", Category.MOVEMENT, false);
    }

    @Override
    public void onTick(MinecraftClient client) {
        if (client.player != null) client.options.sprintKey.setPressed(true);
    }

    @Override
    protected void onDisable() {
        mc().options.sprintKey.setPressed(false);
    }
}
