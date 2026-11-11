package dev.quasar.module.hud;

import dev.quasar.QuasarClient;
import dev.quasar.gui.Colors;
import dev.quasar.module.Category;
import dev.quasar.module.Module;
import net.minecraft.client.font.TextRenderer;
import net.minecraft.client.gui.DrawContext;

public final class Watermark extends Module {
    public Watermark() {
        super("Watermark", "Shows the client name in the top-left corner", Category.HUD, true);
    }

    /** Draws the watermark and returns the y position for the next line. */
    public int render(DrawContext ctx, TextRenderer tr, int x, int y) {
        String name = QuasarClient.NAME;
        int cx = x;
        for (int i = 0; i < name.length(); i++) {
            String ch = String.valueOf(name.charAt(i));
            ctx.drawTextWithShadow(tr, ch, cx, y, Colors.rainbow(i * 120L));
            cx += tr.getWidth(ch);
        }
        ctx.drawTextWithShadow(tr, " v" + QuasarClient.VERSION, cx, y, Colors.GRAY);
        return y + tr.fontHeight + 3;
    }
}
