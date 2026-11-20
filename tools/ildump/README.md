# ildump

A throwaway IL disassembler used to read how KSP's CommNet really works from the game's own `Assembly-CSharp.dll`
(for interoperability research on a copy you own). It uses only `System.Reflection.Metadata` from the .NET SDK.

```
cd tools/ildump && dotnet build -c Release
dotnet bin/Release/net9.0/ildump.dll "<KSP>/KSP_x64_Data/Managed/Assembly-CSharp.dll" list CommNet
dotnet bin/Release/net9.0/ildump.dll "<KSP>/KSP_x64_Data/Managed/Assembly-CSharp.dll" dump CommNet.CommNetBody CreateOccluder
```

`list <substr>` lists matching types; `dump <typeSubstr> [methodSubstr]` prints their IL. Do not commit the game's
IL output; record the *findings* in `docs/RESEARCH.md` instead. (`bin/` and `obj/` are git-ignored.)

## Legal note

This tool is original code: it contains none of the game's code and ships no game files. Run it only on a copy of the
game that you own. Do not redistribute the game's assemblies or the IL it prints, and check the game's licence terms
and your local law before you use the output for anything beyond interoperability and compatibility research. This is
not legal advice.
