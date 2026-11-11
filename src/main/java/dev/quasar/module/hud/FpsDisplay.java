package dev.quasar.module.hud;

import dev.quasar.gui.Colors;
import dev.quasar.module.Category;
import dev.quasar.module.Module;
import net.minecraft.client.font.TextRenderer;
import net.minecraft.client.gui.DrawContext;

public final class FpsDisplay extends Module {
    public FpsDisplay() {
        super("FPS", "Shows your frames per second", Category.HUD, true);
    }

    public int render(DrawContext ctx, TextRenderer tr, int x, int y) {
        return Colors.labelLine(ctx, tr, "FPS", String.valueOf(mc().getCurrentFps()), x, y);
    }
}
