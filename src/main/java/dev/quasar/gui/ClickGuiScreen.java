package dev.quasar.gui;

import dev.quasar.Config;
import dev.quasar.QuasarClient;
import dev.quasar.module.Category;
import dev.quasar.module.Module;
import dev.quasar.module.ModuleManager;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.text.Text;

import java.util.EnumMap;
import java.util.List;
import java.util.Map;

/** Right Shift menu: one draggable panel per category, click a module to toggle it. */
public class ClickGuiScreen extends Screen {
    private static final int PANEL_WIDTH = 110;
    private static final int HEADER_HEIGHT = 16;
    private static final int ROW_HEIGHT = 14;

    /** Panel positions survive closing and reopening the menu. */
    private static final Map<Category, int[]> POSITIONS = new EnumMap<>(Category.class);

    private Category dragging;
    private int dragOffsetX;
    private int dragOffsetY;

    public ClickGuiScreen() {
        super(Text.literal("Quasar Click GUI"));
        int i = 0;
        for (Category category : Category.values()) {
            POSITIONS.putIfAbsent(category, new int[]{20 + i * (PANEL_WIDTH + 12), 34});
            i++;
        }
    }

    @Override
    public void render(DrawContext ctx, int mouseX, int mouseY, float delta) {
        super.render(ctx, mouseX, mouseY, delta); // draws the blurred background

        String title = QuasarClient.NAME + " Client";
        ctx.drawCenteredTextWithShadow(textRenderer, title, width / 2, 12, Colors.rainbow(0));

        Module hovered = null;
        for (Category category : Category.values()) {
            int[] pos = POSITIONS.get(category);
            int px = pos[0];
            int py = pos[1];

            ctx.fill(px, py, px + PANEL_WIDTH, py + HEADER_HEIGHT, Colors.ACCENT);
            ctx.drawCenteredTextWithShadow(textRenderer, category.displayName, px + PANEL_WIDTH / 2, py + 4, Colors.WHITE);

            int rowY = py + HEADER_HEIGHT;
            for (Module module : ModuleManager.byCategory(category)) {
                boolean over = inside(mouseX, mouseY, px, rowY, PANEL_WIDTH, ROW_HEIGHT);
                if (over) hovered = module;

                int bg = module.isEnabled() ? 0xE0352E66 : 0xE0141418;
                if (over) bg = module.isEnabled() ? 0xE0463D85 : 0xE0262630;
                ctx.fill(px, rowY, px + PANEL_WIDTH, rowY + ROW_HEIGHT, bg);
                if (module.isEnabled()) ctx.fill(px, rowY, px + 2, rowY + ROW_HEIGHT, Colors.ACCENT);

                int textColor = module.isEnabled() ? Colors.WHITE : Colors.GRAY;
                ctx.drawTextWithShadow(textRenderer, module.getName(), px + 6, rowY + 3, textColor);
                rowY += ROW_HEIGHT;
            }
            ctx.fill(px, rowY, px + PANEL_WIDTH, rowY + 2, Colors.ACCENT);
        }

        String footer = hovered != null ? hovered.getDescription() : "Click a module to toggle it - drag headers to move panels";
        ctx.drawCenteredTextWithShadow(textRenderer, footer, width / 2, height - 16, Colors.GRAY);
    }

    @Override
    public boolean mouseClicked(double mouseX, double mouseY, int button) {
        for (Category category : Category.values()) {
            int[] pos = POSITIONS.get(category);
            if (button == 0 && inside(mouseX, mouseY, pos[0], pos[1], PANEL_WIDTH, HEADER_HEIGHT)) {
                dragging = category;
                dragOffsetX = (int) mouseX - pos[0];
                dragOffsetY = (int) mouseY - pos[1];
                return true;
            }
            List<Module> modules = ModuleManager.byCategory(category);
            int rowY = pos[1] + HEADER_HEIGHT;
            for (Module module : modules) {
                if (inside(mouseX, mouseY, pos[0], rowY, PANEL_WIDTH, ROW_HEIGHT)) {
                    module.toggle();
                    return true;
                }
                rowY += ROW_HEIGHT;
            }
        }
        return super.mouseClicked(mouseX, mouseY, button);
    }

    @Override
    public boolean mouseDragged(double mouseX, double mouseY, int button, double deltaX, double deltaY) {
        if (dragging != null) {
            int[] pos = POSITIONS.get(dragging);
            pos[0] = (int) mouseX - dragOffsetX;
            pos[1] = (int) mouseY - dragOffsetY;
            return true;
        }
        return super.mouseDragged(mouseX, mouseY, button, deltaX, deltaY);
    }

    @Override
    public boolean mouseReleased(double mouseX, double mouseY, int button) {
        dragging = null;
        return super.mouseReleased(mouseX, mouseY, button);
    }

    @Override
    public boolean shouldPause() {
        return false;
    }

    @Override
    public void close() {
        Config.save();
        super.close();
    }

    private static boolean inside(double mx, double my, int x, int y, int w, int h) {
        return mx >= x && mx < x + w && my >= y && my < y + h;
    }
}
