using System;
using UnityEngine;
using UnityEngine.UI;

public class DialogueManager : MonoBehaviour
{
    public static DialogueManager Instance;

    public GameObject dialoguePanel;
    public Text nameText;
    public Text dialogueText;
    public KeyCode advanceKey = KeyCode.Space;

    private string[] currentDialogue;
    private int currentLineIndex;
    private Action onDialogueEnd;
    private bool isDialogueActive;

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
        if (dialoguePanel != null)
        {
            dialoguePanel.SetActive(false);
        }
    }

    private void Update()
    {
        if (isDialogueActive && Input.GetKeyDown(advanceKey))
        {
            AdvanceDialogue();
        }
    }

    public void ShowDialogue(string npcName, string[] lines, Action onEnd = null)
    {
        currentDialogue = lines;
        currentLineIndex = 0;
        onDialogueEnd = onEnd;
        isDialogueActive = true;

        if (nameText != null) nameText.text = npcName;
        if (dialoguePanel != null) dialoguePanel.SetActive(true);
        
        DisplayCurrentLine();
    }

    private void DisplayCurrentLine()
    {
        if (dialogueText != null && currentLineIndex < currentDialogue.Length)
        {
            dialogueText.text = currentDialogue[currentLineIndex];
        }
    }

    private void AdvanceDialogue()
    {
        currentLineIndex++;
        
        if (currentLineIndex >= currentDialogue.Length)
        {
            EndDialogue();
        }
        else
        {
            DisplayCurrentLine();
        }
    }

    private void EndDialogue()
    {
        isDialogueActive = false;
        if (dialoguePanel != null) dialoguePanel.SetActive(false);
        onDialogueEnd?.Invoke();
    }
}
