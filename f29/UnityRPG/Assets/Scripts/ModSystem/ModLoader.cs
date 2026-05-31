using System.Collections.Generic;
using System.IO;
using UnityEngine;

public class ModLoader : MonoBehaviour
{
    public static ModLoader Instance;
    
    public string modsFolderPath = "../Mods";
    public GameObject npcPrefab;
    public GameObject itemPrefab;
    public KeyCode reloadKey = KeyCode.F5;
    public bool enableAutoReload = false;
    public float autoReloadInterval = 5f;
    
    private Dictionary<string, ModConfig> loadedMods = new Dictionary<string, ModConfig>();
    private Dictionary<string, DateTime> modFileTimestamps = new Dictionary<string, DateTime>();
    private List<GameObject> spawnedNPCs = new List<GameObject>();
    private List<GameObject> spawnedItems = new List<GameObject>();
    private float autoReloadTimer;

    private void Awake()
    {
        if (Instance == null)
        {
            Instance = this;
        }
        else
        {
            Destroy(gameObject);
        }
    }

    private void Start()
    {
        LoadAllMods();
    }

    private void Update()
    {
        if (Input.GetKeyDown(reloadKey))
        {
            ReloadAllMods();
        }

        if (enableAutoReload)
        {
            autoReloadTimer += Time.deltaTime;
            if (autoReloadTimer >= autoReloadInterval)
            {
                autoReloadTimer = 0f;
                CheckAndReloadModifiedMods();
            }
        }
    }

    public void ReloadAllMods()
    {
        Debug.Log("========== 开始热重载Mods ==========");
        int modCount = loadedMods.Count;
        LoadAllMods();
        Debug.Log($"========== 热重载完成，{modCount} -> {loadedMods.Count} 个Mod ==========");
    }

    private void CheckAndReloadModifiedMods()
    {
        string fullPath = Path.GetFullPath(Path.Combine(Application.dataPath, modsFolderPath));
        if (!Directory.Exists(fullPath)) return;

        string[] jsonFiles = Directory.GetFiles(fullPath, "*.json");
        bool hasChanges = false;

        foreach (string file in jsonFiles)
        {
            DateTime lastWriteTime = File.GetLastWriteTime(file);
            string fileName = Path.GetFileName(file);
            
            if (!modFileTimestamps.ContainsKey(fileName) || modFileTimestamps[fileName] < lastWriteTime)
            {
                hasChanges = true;
                break;
            }
        }

        if (hasChanges)
        {
            Debug.Log("检测到Mod文件变更，自动热重载...");
            ReloadAllMods();
        }
    }

    public void LoadAllMods()
    {
        ClearExistingContent();
        modFileTimestamps.Clear();
        
        string fullPath = Path.GetFullPath(Path.Combine(Application.dataPath, modsFolderPath));
        
        if (!Directory.Exists(fullPath))
        {
            Directory.CreateDirectory(fullPath);
            Debug.Log("创建Mods文件夹: " + fullPath);
            return;
        }

        string[] jsonFiles = Directory.GetFiles(fullPath, "*.json");
        
        foreach (string file in jsonFiles)
        {
            string fileName = Path.GetFileName(file);
            modFileTimestamps[fileName] = File.GetLastWriteTime(file);
            LoadModFromFile(file);
        }
        
        Debug.Log($"加载完成，共加载 {loadedMods.Count} 个Mod");
    }

    private void LoadModFromFile(string filePath)
    {
        try
        {
            string jsonContent = File.ReadAllText(filePath);
            ModConfig modConfig = JsonUtility.FromJson<ModConfig>(jsonContent);
            
            if (modConfig != null && !string.IsNullOrEmpty(modConfig.modId))
            {
                loadedMods[modConfig.modId] = modConfig;
                SpawnModContent(modConfig);
                Debug.Log($"加载Mod: {modConfig.modName} v{modConfig.version} by {modConfig.author}");
            }
        }
        catch (System.Exception e)
        {
            Debug.LogError($"加载Mod失败 {filePath}: {e.Message}");
        }
    }

    public void LoadModFromConfig(ModConfig modConfig)
    {
        if (modConfig == null || string.IsNullOrEmpty(modConfig.modId)) return;
        
        if (loadedMods.ContainsKey(modConfig.modId))
        {
            RemoveModContent(modConfig.modId);
        }
        
        loadedMods[modConfig.modId] = modConfig;
        SpawnModContent(modConfig);
        Debug.Log($"热更新Mod: {modConfig.modName} v{modConfig.version}");
    }

    private void SpawnModContent(ModConfig modConfig)
    {
        if (modConfig.npcs != null)
        {
            foreach (ModNPCData npcData in modConfig.npcs)
            {
                SpawnNPC(npcData);
            }
        }

        if (modConfig.items != null)
        {
            foreach (ModItemData itemData in modConfig.items)
            {
                SpawnItem(itemData);
            }
        }
    }

    private void SpawnNPC(ModNPCData npcData)
    {
        if (npcPrefab == null)
        {
            Debug.LogWarning("NPC预制体未设置，创建默认NPC");
            CreateDefaultNPC(npcData);
            return;
        }

        GameObject npcObject = Instantiate(npcPrefab);
        NPCController npcController = npcObject.GetComponent<NPCController>();
        
        if (npcController != null)
        {
            npcController.Initialize(npcData);
        }
        
        npcObject.name = $"NPC_{npcData.id}";
        spawnedNPCs.Add(npcObject);
    }

    private void CreateDefaultNPC(ModNPCData npcData)
    {
        GameObject npcObject = new GameObject($"NPC_{npcData.id}");
        npcObject.tag = "NPC";
        
        npcObject.AddComponent<SpriteRenderer>();
        npcObject.AddComponent<BoxCollider2D>().isTrigger = true;
        Rigidbody2D rb = npcObject.AddComponent<Rigidbody2D>();
        rb.isKinematic = true;
        
        NPCController npcController = npcObject.AddComponent<NPCController>();
        npcController.Initialize(npcData);
        
        spawnedNPCs.Add(npcObject);
    }

    private void SpawnItem(ModItemData itemData)
    {
        if (itemPrefab == null)
        {
            CreateDefaultItem(itemData);
            return;
        }

        GameObject itemObject = Instantiate(itemPrefab);
        ItemController itemController = itemObject.GetComponent<ItemController>();
        
        if (itemController != null)
        {
            itemController.Initialize(itemData);
        }
        
        itemObject.name = $"Item_{itemData.id}";
        spawnedItems.Add(itemObject);
    }

    private void CreateDefaultItem(ModItemData itemData)
    {
        GameObject itemObject = new GameObject($"Item_{itemData.id}");
        itemObject.tag = "Item";
        
        itemObject.AddComponent<SpriteRenderer>();
        BoxCollider2D collider = itemObject.AddComponent<BoxCollider2D>();
        collider.isTrigger = true;
        
        ItemController itemController = itemObject.AddComponent<ItemController>();
        itemController.Initialize(itemData);
        
        spawnedItems.Add(itemObject);
    }

    private void RemoveModContent(string modId)
    {
        if (!loadedMods.ContainsKey(modId)) return;
        
        ModConfig modConfig = loadedMods[modId];
        
        if (modConfig.npcs != null)
        {
            foreach (ModNPCData npcData in modConfig.npcs)
            {
                GameObject npc = spawnedNPCs.Find(n => n.name == $"NPC_{npcData.id}");
                if (npc != null)
                {
                    spawnedNPCs.Remove(npc);
                    Destroy(npc);
                }
            }
        }

        if (modConfig.items != null)
        {
            foreach (ModItemData itemData in modConfig.items)
            {
                GameObject item = spawnedItems.Find(i => i.name == $"Item_{itemData.id}");
                if (item != null)
                {
                    spawnedItems.Remove(item);
                    Destroy(item);
                }
            }
        }
        
        loadedMods.Remove(modId);
    }

    private void ClearExistingContent()
    {
        foreach (GameObject npc in spawnedNPCs)
        {
            Destroy(npc);
        }
        spawnedNPCs.Clear();

        foreach (GameObject item in spawnedItems)
        {
            Destroy(item);
        }
        spawnedItems.Clear();
        
        loadedMods.Clear();
    }

    public ModConfig GetMod(string modId)
    {
        loadedMods.TryGetValue(modId, out ModConfig mod);
        return mod;
    }

    public List<ModConfig> GetAllLoadedMods()
    {
        return new List<ModConfig>(loadedMods.Values);
    }
}
