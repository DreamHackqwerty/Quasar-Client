package dev.quasar.module.render;

import dev.quasar.mixin.SimpleOptionAccessor;
import dev.quasar.module.Category;
import dev.quasar.module.Module;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.option.SimpleOption;

/**
 * Pushes brightness far past the slider's 100% limit so caves are fully lit.
 * The value is set through an accessor because the normal setter rejects anything above 1.0.
 */
public final class Fullbright extends Module {
    private static final double BRIGHT = 16.0;
    private Double savedGamma;

    public Fullbright() {
        super("Fullbright", "Makes everything fully lit", Category.RENDER, false);
    }

    @Override
    public void onTick(MinecraftClient client) {
        if (client.options == null) return;
        SimpleOption<Double> gamma = client.options.getGamma();
        if (gamma.getValue() < BRIGHT) {
            if (savedGamma == null) savedGamma = gamma.getValue();
            ((SimpleOptionAccessor) (Object) gamma).quasar$setValue(BRIGHT);
        }
    }

    @Override
    protected void onDisable() {
        restore();
    }

    /** Puts the player's own brightness back. */
    public void restore() {
        MinecraftClient client = mc();
        if (savedGamma == null || client == null || client.options == null) return;
        ((SimpleOptionAccessor) (Object) client.options.getGamma()).quasar$setValue(savedGamma);
        savedGamma = null;
    }
}
