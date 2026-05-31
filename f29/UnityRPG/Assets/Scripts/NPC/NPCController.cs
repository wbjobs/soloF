using UnityEngine;

public class NPCController : MonoBehaviour
{
    public string npcId = "";
    public string npcName = "未知NPC";
    public string[] dialogueLines = new string[0];
    public Sprite npcSprite;

    private SpriteRenderer spriteRenderer;
    private GameObject interactionIndicator;
    private bool isInDialogue;

    private void Awake()
    {
        spriteRenderer = GetComponent<SpriteRenderer>();
        CreateInteractionIndicator();
    }

    private void Start()
    {
        if (npcSprite != null && spriteRenderer != null)
        {
            spriteRenderer.sprite = npcSprite;
        }
    }

    private void CreateInteractionIndicator()
    {
        interactionIndicator = new GameObject("InteractionIndicator");
        interactionIndicator.transform.SetParent(transform);
        interactionIndicator.transform.localPosition = new Vector3(0, 1.5f, 0);
        
        SpriteRenderer indicatorRenderer = interactionIndicator.AddComponent<SpriteRenderer>();
        indicatorRenderer.color = Color.yellow;
        indicatorRenderer.enabled = false;
        
        interactionIndicator.SetActive(false);
    }

    public void Initialize(ModNPCData data)
    {
        if (data == null) return;
        
        npcId = data.id ?? "";
        npcName = data.name ?? "未知NPC";
        dialogueLines = data.dialogueLines ?? new string[0];
        
        float posX = data.position != null ? data.position.x : 0f;
        float posY = data.position != null ? data.position.y : 0f;
        transform.position = new Vector3(posX, posY, 0);
    }

    public void StartDialogue()
    {
        if (isInDialogue) return;
        
        isInDialogue = true;
        if (DialogueManager.Instance != null)
        {
            DialogueManager.Instance.ShowDialogue(npcName, dialogueLines, OnDialogueEnd);
        }
    }

    private void OnDialogueEnd()
    {
        isInDialogue = false;
    }

    public void ShowInteractionIndicator(bool show)
    {
        if (interactionIndicator != null)
        {
            interactionIndicator.SetActive(show);
        }
    }
}
