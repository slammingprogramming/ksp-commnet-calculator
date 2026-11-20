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

    static void Dump(MethodDefinition m, string label)
    {
        if (m.RelativeVirtualAddress == 0) return;
        var body = pe.GetMethodBody(m.RelativeVirtualAddress);
        var il = body.GetILBytes();
        Console.WriteLine("  == " + label + "  (IL " + il.Length + " bytes)");
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
                        i += 4 * n; operand = "switch(" + n + ")"; break;
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
            foreach (var fh in td.GetFields()) { var f = md.GetFieldDefinition(fh); Console.WriteLine("  field " + md.GetString(f.Name)); }
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
