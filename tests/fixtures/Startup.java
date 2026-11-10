package fixture;

import net.fabricmc.api.ClientModInitializer;

public final class Startup implements ClientModInitializer {
    @Override
    public void onInitializeClient() {
        System.out.println("Hello from HorizonRelay's fixture. 🚀");
    }
}
