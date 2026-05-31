using UnityEngine;

public class ItemController : MonoBehaviour
{
    public string itemId = "";
    public string itemName = "未知物品";
    public string description = "";
    public string itemType = "普通";
    public int value = 0;
    public int attackBonus = 0;
    public int defenseBonus = 0;
    public int damage = 0;

    private SpriteRenderer spriteRenderer;

    private void Awake()
    {
        spriteRenderer = GetComponent<SpriteRenderer>();
    }

    public void Initialize(ModItemData data)
    {
        if (data == null) return;
        
        itemId = data.id ?? "";
        itemName = data.name ?? "未知物品";
        description = data.description ?? "";
        itemType = data.type ?? "普通";
        value = data.value;
        attackBonus = data.attackBonus;
        defenseBonus = data.defenseBonus;
        damage = data.damage;
    }

    private void OnTriggerEnter2D(Collider2D other)
    {
        if (other != null && other.CompareTag("Player"))
        {
            PickupItem();
        }
    }

    private void PickupItem()
    {
        Debug.Log($"拾取物品: {itemName}");
        if (InventoryManager.Instance != null)
        {
            InventoryManager.Instance.AddItem(this);
        }
        Destroy(gameObject);
    }
}
