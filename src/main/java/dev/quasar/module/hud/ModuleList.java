package dev.quasar.module.hud;

import dev.quasar.gui.Colors;
import dev.quasar.module.Category;
import dev.quasar.module.Module;
import dev.quasar.module.ModuleManager;
import net.minecraft.client.font.TextRenderer;
import net.minecraft.client.gui.DrawContext;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

public final class ModuleList extends Module {
    public ModuleList() {
        super("Module List", "Lists active modules in the top-right corner", Category.HUD, true);
    }

    public void render(DrawContext ctx, TextRenderer tr) {
        List<Module> active = new ArrayList<>();
        for (Module module : ModuleManager.all()) {
            if (module.isEnabled() && module.showInModuleList()) active.add(module);
        }
        active.sort(Comparator.comparingInt((Module m) -> tr.getWidth(m.getName())).reversed());

        int right = ctx.getScaledWindowWidth();
        int y = 2;
        for (int i = 0; i < active.size(); i++) {
            String name = active.get(i).getName();
            int color = Colors.rainbow(i * 150L);
            int x = right - tr.getWidth(name) - 5;
            ctx.fill(x - 3, y, right, y + 11, 0x90000000);
            ctx.fill(right - 2, y, right, y + 11, color);
            ctx.drawTextWithShadow(tr, name, x, y + 2, color);
            y += 11;
        }
    }
}
