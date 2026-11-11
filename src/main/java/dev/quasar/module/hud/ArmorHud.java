package dev.quasar.module.hud;

import dev.quasar.module.Category;
import dev.quasar.module.Module;
import net.minecraft.client.font.TextRenderer;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.network.ClientPlayerEntity;
import net.minecraft.item.ItemStack;

import java.util.ArrayList;
import java.util.List;

public final class ArmorHud extends Module {
    public ArmorHud() {
        super("Armor HUD", "Shows your armor and its durability next to the hotbar", Category.HUD, true);
    }

    public void render(DrawContext ctx, TextRenderer tr, ClientPlayerEntity player) {
        // getArmorItems() goes boots -> helmet; flip it so the helmet is first.
        List<ItemStack> armor = new ArrayList<>();
        for (ItemStack stack : player.getArmorItems()) armor.add(0, stack);

        int x = ctx.getScaledWindowWidth() / 2 + 98;
        int y = ctx.getScaledWindowHeight() - 19;
        for (ItemStack stack : armor) {
            if (stack.isEmpty()) continue;
            ctx.drawItem(stack, x, y);
            ctx.drawItemInSlot(tr, stack, x, y);
            x += 18;
        }
    }
}
