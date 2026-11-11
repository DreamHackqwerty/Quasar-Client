package dev.quasar.module.render;

import dev.quasar.module.Category;
import dev.quasar.module.Module;
import net.minecraft.client.MinecraftClient;

/** Hold the zoom key (C by default) to zoom in 4x with smooth camera. */
public final class Zoom extends Module {
    private static final double ZOOMED = 0.25;

    private boolean held;
    private boolean smoothApplied;
    private boolean savedSmooth;
    private double current = 1.0;
    private long lastFrame = System.nanoTime();

    public Zoom() {
        super("Zoom", "Hold C to zoom in", Category.RENDER, true);
    }

    public void setHeld(boolean pressed) {
        held = pressed && isEnabled() && mc().currentScreen == null;
    }

    @Override
    public void onTick(MinecraftClient client) {
        if (held && !smoothApplied) {
            savedSmooth = client.options.smoothCameraEnabled;
            client.options.smoothCameraEnabled = true;
            smoothApplied = true;
        } else if (!held && smoothApplied) {
            restoreSmooth(client);
        }
    }

    @Override
    protected void onDisable() {
        held = false;
        restoreSmooth(mc());
    }

    private void restoreSmooth(MinecraftClient client) {
        if (!smoothApplied) return;
        client.options.smoothCameraEnabled = savedSmooth;
        smoothApplied = false;
    }

    /** Called from GameRendererMixin every time the FOV is calculated. Eases toward the target. */
    public double getFovMultiplier() {
        long now = System.nanoTime();
        double dt = Math.min((now - lastFrame) / 1_000_000_000.0, 0.1);
        lastFrame = now;

        double target = held ? ZOOMED : 1.0;
        current += (target - current) * (1.0 - Math.exp(-dt * 14.0));
        if (!held && Math.abs(current - 1.0) < 0.001) current = 1.0;
        return current;
    }
}
