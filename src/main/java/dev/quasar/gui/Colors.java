package dev.quasar.gui;

import net.minecraft.client.font.TextRenderer;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.util.math.MathHelper;

public final class Colors {
    public static final int ACCENT = 0xFF8A7CFF;
    public static final int WHITE = 0xFFFFFFFF;
    public static final int GRAY = 0xFFAAAAAA;

    private Colors() {}

    /** A slowly cycling pastel rainbow; offset shifts the hue so neighbours differ. */
    public static int rainbow(long offsetMs) {
        float hue = ((System.currentTimeMillis() + offsetMs) % 4000L) / 4000f;
        return 0xFF000000 | MathHelper.hsvToRgb(hue, 0.5f, 1f);
    }

    /** Draws "Label: value" with the label in the accent colour. Returns the next line's y. */
    public static int labelLine(DrawContext ctx, TextRenderer tr, String label, String value, int x, int y) {
        String prefix = label + ": ";
        ctx.drawTextWithShadow(tr, prefix, x, y, ACCENT);
        ctx.drawTextWithShadow(tr, value, x + tr.getWidth(prefix), y, WHITE);
        return y + tr.fontHeight + 2;
    }
}
