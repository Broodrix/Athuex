-keepclasseswithmembernames class * { native <methods>; }
-keep class com.athuex.MainActivity {
    public native boolean nativeInit(java.lang.String, java.lang.String, java.lang.String, java.lang.String);
    public native java.lang.String nativeGenerateLocal(java.lang.String);
    public native void nativeStop();
    public native void nativeDestroy();
}
-dontoptimize