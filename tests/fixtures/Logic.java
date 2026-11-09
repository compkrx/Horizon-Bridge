package fixture;

public final class Logic {
    public static int add(int a, int b) {
        return a + b;
    }

    public static int branches(int value) {
        return value < 0 ? -value : value + 11;
    }

    public static int sum(int value) {
        int total = 0;
        for (int i = 0; i < value; i++) {
            total += i;
        }
        return total;
    }

    public static int unsignedShift(int a, int b) {
        return a >>> b;
    }

    public static int minAbs(int a, int b) {
        return Math.min(Math.abs(a), b);
    }

    public static short narrow(int value) {
        return (short) value;
    }

    public static boolean less(int a, int b) {
        return a < b;
    }

    public static int unsupported(int a, int b) {
        return a / b;
    }
}
