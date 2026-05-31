using System;

[Serializable]
public class ModConfig
{
    public string modId = "";
    public string modName = "未命名Mod";
    public string version = "1.0.0";
    public string author = "未知";
    public ModNPCData[] npcs = new ModNPCData[0];
    public ModItemData[] items = new ModItemData[0];
}

[Serializable]
public class ModNPCData
{
    public string id = "";
    public string name = "未知NPC";
    public string[] dialogueLines = new string[0];
    public PositionData position = new PositionData();
}

[Serializable]
public class ModItemData
{
    public string id = "";
    public string name = "未知物品";
    public string description = "";
    public string type = "普通";
    public int value = 0;
    public int attackBonus = 0;
    public int defenseBonus = 0;
    public int damage = 0;
}

[Serializable]
public class PositionData
{
    public float x = 0f;
    public float y = 0f;
}
