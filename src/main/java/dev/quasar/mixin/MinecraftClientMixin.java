package dev.quasar.mixin;

import dev.quasar.QuasarClient;
import net.minecraft.SharedConstants;
import net.minecraft.client.MinecraftClient;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

@Mixin(MinecraftClient.class)
public abstract class MinecraftClientMixin {
    /** Window title: "Quasar Client 1.0.0 | Minecraft 1.21.1". */
    @Inject(method = "getWindowTitle", at = @At("HEAD"), cancellable = true)
    private void quasar$windowTitle(CallbackInfoReturnable<String> cir) {
        cir.setReturnValue(QuasarClient.NAME + " Client " + QuasarClient.VERSION
                + " | Minecraft " + SharedConstants.getGameVersion().getName());
    }
}
