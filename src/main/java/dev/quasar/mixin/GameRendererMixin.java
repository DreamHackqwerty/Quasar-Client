package dev.quasar.mixin;

import dev.quasar.module.ModuleManager;
import dev.quasar.module.render.Zoom;
import net.minecraft.client.render.Camera;
import net.minecraft.client.render.GameRenderer;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

@Mixin(GameRenderer.class)
public abstract class GameRendererMixin {
    // 1.21.1: private double getFov(Camera camera, float tickDelta, boolean changingFov)
    @Inject(method = "getFov", at = @At("RETURN"), cancellable = true)
    private void quasar$applyZoom(Camera camera, float tickDelta, boolean changingFov,
                                  CallbackInfoReturnable<Double> cir) {
        Zoom zoom = ModuleManager.get(Zoom.class);
        if (zoom == null) return;
        double multiplier = zoom.getFovMultiplier();
        if (multiplier != 1.0) cir.setReturnValue(cir.getReturnValue() * multiplier);
    }
}
