package dev.quasar.module.hud;

import dev.quasar.gui.Colors;
import dev.quasar.module.Category;
import dev.quasar.module.Module;
import net.minecraft.client.font.TextRenderer;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.network.ClientPlayerEntity;

public final class Coordinates extends Module {
    public Coordinates() {
        super("Coordinates", "Shows your XYZ position and facing direction", Category.HUD, true);
    }

    public int render(DrawContext ctx, TextRenderer tr, ClientPlayerEntity player, int x, int y) {
        String xyz = String.format("%.1f, %.1f, %.1f", player.getX(), player.getY(), player.getZ());
        y = Colors.labelLine(ctx, tr, "XYZ", xyz, x, y);

        String facing = player.getHorizontalFacing().asString();
        facing = Character.toUpperCase(facing.charAt(0)) + facing.substring(1);
        return Colors.labelLine(ctx, tr, "Facing", facing, x, y);
    }
}
