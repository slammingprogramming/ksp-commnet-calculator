// SPDX-License-Identifier: AGPL-3.0-or-later
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Reflection.Emit;
using System.Reflection.Metadata;
using System.Reflection.Metadata.Ecma335;
using System.Reflection.PortableExecutable;
using System.Text;

// Throwaway IL dumper: ildump <dll> list <substr>   |   ildump <dll> dump <typeSubstr> [methodSubstr]
class P
{
    static MetadataReader md;
    static PEReader pe;
    static Dictionary<short, OpCode> ops = new Dictionary<short, OpCode>();

    static string TypeName(EntityHandle h)
    {
        try
        {
            switch (h.Kind)
            {
                case HandleKind.TypeDefinition:
                    var td = md.GetTypeDefinition((TypeDefinitionHandle)h);
                    var ns = md.GetString(td.Namespace);
                    var nm = md.GetString(td.Name);
                    return (ns.Length > 0 ? ns + "." : "") + nm;
                case HandleKind.TypeReference:
                    var tr = md.GetTypeReference((TypeReferenceHandle)h);
                    return md.GetString(tr.Name);
                case HandleKind.TypeSpecification: return "TypeSpec";
            }
        }
        catch { }
        return "?";
    }

    static string Resolve(int token)
    {
        var h = MetadataTokens.EntityHandle(token);
        try
        {
            switch (h.Kind)
            {
                case HandleKind.MethodDefinition:
                    var m = md.GetMethodDefinition((MethodDefinitionHandle)h);
                    return TypeName(m.GetDeclaringType()) + "::" + md.GetString(m.Name);
                case HandleKind.MemberReference:
                    var mr = md.GetMemberReference((MemberReferenceHandle)h);
                    return TypeName(mr.Parent) + "::" + md.GetString(mr.Name);
                case HandleKind.FieldDefinition:
                    var f = md.GetFieldDefinition((FieldDefinitionHandle)h);
                    return TypeName(f.GetDeclaringType()) + "::" + md.GetString(f.Name);
                case HandleKind.TypeDefinition:
                case HandleKind.TypeReference:
                    return TypeName(h);
                case HandleKind.MethodSpecification:
                    var ms = md.GetMethodSpecification((MethodSpecificationHandle)h);
                    return Resolve(MetadataTokens.GetToken(ms.Method)) + "<>";
            }
        }
        catch { }
        return "tok:" + token.ToString("X8");
    }

    // Decodes the common field-signature shapes (primitives, string, class/valuetype by name, arrays) for the "fields" listing.
    static string FieldType(BlobReader sr)
    {
        sr.ReadByte(); // 0x06 FIELD
        return ElemType(ref sr);
    }
    static string ElemType(ref BlobReader sr)
    {
        byte t = sr.ReadByte();
        switch (t)
        {
            case 0x02: return "bool"; case 0x03: return "char"; case 0x04: return "sbyte"; case 0x05: return "byte";
            case 0x06: return "short"; case 0x07: return "ushort"; case 0x08: return "int"; case 0x09: return "uint";
            case 0x0a: return "long"; case 0x0b: return "ulong"; case 0x0c: return "float"; case 0x0d: return "double";
            case 0x0e: return "string"; case 0x1c: return "object";
            case 0x11: case 0x12:
            {
                int v = sr.ReadCompressedInteger(); int tag = v & 3, idx = v >> 2;
                string name = tag == 0 ? TypeName(MetadataTokens.TypeDefinitionHandle(idx))
                    : tag == 1 ? md.GetString(md.GetTypeReference(MetadataTokens.TypeReferenceHandle(idx)).Name) : "typespec";
                return (t == 0x11 ? "struct " : "class ") + name;
            }
            case 0x1d: return ElemType(ref sr) + "[]";
            case 0x15: { string g = ElemType(ref sr); int n = sr.ReadCompressedInteger(); var a = new List<string>(); for (int i = 0; i < n; i++) a.Add(ElemType(ref sr)); return g + "<" + string.Join(",", a) + ">"; }
            default: return "?0x" + t.ToString("x2");
        }
    }
    // "(this) ret(params)" for the method header: enough to tell overloads apart.
    static string SigText(MethodDefinition m)
    {
        try
        {
            var sr = md.GetBlobReader(m.Signature);
            byte hdr = sr.ReadByte();
            if ((hdr & 0x10) != 0) sr.ReadCompressedInteger();
            int n = sr.ReadCompressedInteger();
            string ret = ElemType(ref sr);
            var ps = new List<string>();
            for (int i = 0; i < n; i++) ps.Add(ElemType(ref sr));
            return ((hdr & 0x20) != 0 ? "instance " : "static ") + ret + "(" + string.Join(", ", ps) + ")";
        }
        catch { return ""; }
    }
    static void Dump(MethodDefinition m, string label)
    {
        if (m.RelativeVirtualAddress == 0) return;
        var body = pe.GetMethodBody(m.RelativeVirtualAddress);
        var il = body.GetILBytes();
        Console.WriteLine("  == " + label + "  (IL " + il.Length + " bytes)" + "  " + SigText(m));
        int i = 0;
        while (i < il.Length)
        {
            int start = i;
            short code = il[i++];
            if (code == 0xFE) code = (short)(0xFE00 | il[i++]);
            OpCode op;
            if (!ops.TryGetValue(code, out op)) { Console.WriteLine("    ?? " + code.ToString("X")); continue; }
            string operand = "";
            switch (op.OperandType)
            {
                case OperandType.InlineNone: break;
                case OperandType.ShortInlineBrTarget: { sbyte d = (sbyte)il[i++]; operand = "IL_" + (i + d).ToString("X4"); break; }
                case OperandType.InlineBrTarget: { int d = BitConverter.ToInt32(il, i); i += 4; operand = "IL_" + (i + d).ToString("X4"); break; }
                case OperandType.ShortInlineI: operand = ((sbyte)il[i++]).ToString(); break;
                case OperandType.ShortInlineVar: operand = il[i++].ToString(); break;
                case OperandType.InlineVar: operand = BitConverter.ToUInt16(il, i).ToString(); i += 2; break;
                case OperandType.InlineI: operand = BitConverter.ToInt32(il, i).ToString(); i += 4; break;
                case OperandType.InlineI8: operand = BitConverter.ToInt64(il, i).ToString(); i += 8; break;
                case OperandType.ShortInlineR: operand = BitConverter.ToSingle(il, i).ToString("R"); i += 4; break;
                case OperandType.InlineR: operand = BitConverter.ToDouble(il, i).ToString("R"); i += 8; break;
                case OperandType.InlineString:
                    {
                        int t = BitConverter.ToInt32(il, i); i += 4;
                        try { operand = "\"" + md.GetUserString(MetadataTokens.UserStringHandle(t & 0xFFFFFF)) + "\""; } catch { operand = "str"; }
                        break;
                    }
                case OperandType.InlineSwitch:
                    {
                        int n = BitConverter.ToInt32(il, i); i += 4;
                        int baseOff = i + 4 * n;
                        var targets = new System.Text.StringBuilder();
                        for (int k = 0; k < n; k++) { int d = BitConverter.ToInt32(il, i + 4 * k); targets.Append(k == 0 ? "" : ",").Append("IL_").Append((baseOff + d).ToString("X4")); }
                        i += 4 * n; operand = "switch(" + n + ") [" + targets + "]"; break;
                    }
                default: { int t = BitConverter.ToInt32(il, i); i += 4; operand = Resolve(t); break; }
            }
            Console.WriteLine("    IL_" + start.ToString("X4") + ": " + op.Name + " " + operand);
        }
    }

    static void Main(string[] args)
    {
        foreach (var f in typeof(OpCodes).GetFields(BindingFlags.Public | BindingFlags.Static))
        {
            var o = (OpCode)f.GetValue(null);
            ops[o.Value] = o;
        }
        pe = new PEReader(File.OpenRead(args[0]));
        md = pe.GetMetadataReader();
        string mode = args[1], tsub = args[2];
        string msub = args.Length > 3 ? args[3] : null;
        foreach (var th in md.TypeDefinitions)
        {
            var td = md.GetTypeDefinition(th);
            string full = TypeName(th);
            if (full.IndexOf(tsub, StringComparison.OrdinalIgnoreCase) < 0) continue;
            if (mode == "list")
            {
                Console.WriteLine(full + "  methods=" + td.GetMethods().Count + " fields=" + td.GetFields().Count);
                continue;
            }
            Console.WriteLine("### " + full);
            foreach (var fh in td.GetFields()) { var f = md.GetFieldDefinition(fh); var sr = md.GetBlobReader(f.Signature); Console.WriteLine("  field " + md.GetString(f.Name) + "  [" + f.Attributes + "]  type=" + FieldType(sr)); }
            foreach (var mh in td.GetMethods())
            {
                var m = md.GetMethodDefinition(mh);
                string mn = md.GetString(m.Name);
                if (msub != null && mn.IndexOf(msub, StringComparison.OrdinalIgnoreCase) < 0) continue;
                Dump(m, mn);
            }
        }
    }
}
