using System.Collections.Generic;
using UnityEngine;

public class InventoryManager : MonoBehaviour
{
    public static InventoryManager Instance;

    public List<ItemController> items = new List<ItemController>();
    public int maxSlots = 20;

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

    public bool AddItem(ItemController item)
    {
        if (items.Count >= maxSlots)
        {
            Debug.Log("背包已满！");
            return false;
        }

        items.Add(item);
        Debug.Log($"添加物品: {item.itemName}，当前物品数: {items.Count}");
        return true;
    }

    public bool RemoveItem(ItemController item)
    {
        return items.Remove(item);
    }

    public ItemController GetItem(string itemId)
    {
        return items.Find(i => i.itemId == itemId);
    }

    public List<ItemController> GetAllItems()
    {
        return new List<ItemController>(items);
    }
}
