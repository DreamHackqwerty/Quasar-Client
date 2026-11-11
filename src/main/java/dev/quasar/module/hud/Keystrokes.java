package dev.quasar.module.hud;

import dev.quasar.module.Category;
import dev.quasar.module.Module;
import net.minecraft.client.font.TextRenderer;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.option.GameOptions;

import java.util.ArrayDeque;
import java.util.Deque;

public final class Keystrokes extends Module {
    private static final int SIZE = 22;
    private static final int GAP = 2;

    private final Deque<Long> leftClicks = new ArrayDeque<>();
    private final Deque<Long> rightClicks = new ArrayDeque<>();
    private boolean lastLeft;
    private boolean lastRight;

    public Keystrokes() {
        super("Keystrokes", "Shows WASD, mouse buttons and clicks per second", Category.HUD, true);
    }

    public void render(DrawContext ctx, TextRenderer tr, int x, int y) {
        GameOptions o = mc().options;
        boolean left = o.attackKey.isPressed();
        boolean right = o.useKey.isPressed();
        long now = System.currentTimeMillis();

        if (left && !lastLeft) leftClicks.add(now);
        if (right && !lastRight) rightClicks.add(now);
        lastLeft = left;
        lastRight = right;
        while (!leftClicks.isEmpty() && now - leftClicks.peekFirst() > 1000) leftClicks.pollFirst();
        while (!rightClicks.isEmpty() && now - rightClicks.peekFirst() > 1000) rightClicks.pollFirst();

        int step = SIZE + GAP;
        int fullWidth = SIZE * 3 + GAP * 2;
        int half = (fullWidth - GAP) / 2;

        key(ctx, tr, "W", null, x + step, y, SIZE, SIZE, o.forwardKey.isPressed());
        key(ctx, tr, "A", null, x, y + step, SIZE, SIZE, o.leftKey.isPressed());
        key(ctx, tr, "S", null, x + step, y + step, SIZE, SIZE, o.backKey.isPressed());
        key(ctx, tr, "D", null, x + step * 2, y + step, SIZE, SIZE, o.rightKey.isPressed());
        key(ctx, tr, "LMB", leftClicks.size() + " CPS", x, y + step * 2, half, SIZE, left);
        key(ctx, tr, "RMB", rightClicks.size() + " CPS", x + half + GAP, y + step * 2, fullWidth - half - GAP, SIZE, right);
        key(ctx, tr, "------", null, x, y + step * 3, fullWidth, 12, o.jumpKey.isPressed());
    }

    private static void key(DrawContext ctx, TextRenderer tr, String label, String sub,
                            int x, int y, int w, int h, boolean pressed) {
        ctx.fill(x, y, x + w, y + h, pressed ? 0xC0FFFFFF : 0x80000000);
        int color = pressed ? 0xFF000000 : 0xFFFFFFFF;
        if (sub == null) {
            ctx.drawText(tr, label, x + (w - tr.getWidth(label)) / 2, y + (h - 8) / 2, color, !pressed);
        } else {
            ctx.drawText(tr, label, x + (w - tr.getWidth(label)) / 2, y + 3, color, !pressed);
            ctx.getMatrices().push();
            ctx.getMatrices().translate(x + w / 2f, y + 13, 0);
            ctx.getMatrices().scale(0.75f, 0.75f, 1f);
            ctx.drawText(tr, sub, -tr.getWidth(sub) / 2, 0, color, !pressed);
            ctx.getMatrices().pop();
        }
    }
}
