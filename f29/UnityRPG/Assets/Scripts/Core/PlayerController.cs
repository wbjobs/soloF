using UnityEngine;

public class PlayerController : MonoBehaviour
{
    [Header("移动设置")]
    public float moveSpeed = 5f;
    public float attackCooldown = 0.5f;

    [Header("攻击设置(矩形)")]
    public float attackWidth = 1.5f;
    public float attackHeight = 1f;
    public float attackForwardDistance = 0.5f;

    [Header("对话设置")]
    public float dialogueRange = 2f;
    public KeyCode dialogueKey = KeyCode.E;

    private Rigidbody2D rb;
    private Vector2 movement;
    private Animator animator;
    private bool canAttack = true;
    private NPCController nearestNPC;
    private Vector2 lastMoveDirection = Vector2.right;

    private void Awake()
    {
        rb = GetComponent<Rigidbody2D>();
        animator = GetComponent<Animator>();
    }

    private void Update()
    {
        HandleMovementInput();
        HandleAttackInput();
        HandleDialogueInput();
        CheckNearbyNPCs();
    }

    private void FixedUpdate()
    {
        Move();
    }

    private void HandleMovementInput()
    {
        movement.x = Input.GetAxisRaw("Horizontal");
        movement.y = Input.GetAxisRaw("Vertical");
        movement.Normalize();

        if (movement != Vector2.zero)
        {
            lastMoveDirection = movement;
        }

        if (animator != null)
        {
            animator.SetFloat("Speed", movement.sqrMagnitude);
            if (movement != Vector2.zero)
            {
                animator.SetFloat("MoveX", movement.x);
                animator.SetFloat("MoveY", movement.y);
            }
        }
    }

    private void HandleAttackInput()
    {
        if (Input.GetMouseButtonDown(0) && canAttack)
        {
            Attack();
        }
    }

    private void HandleDialogueInput()
    {
        if (Input.GetKeyDown(dialogueKey) && nearestNPC != null)
        {
            nearestNPC.StartDialogue();
        }
    }

    private void Move()
    {
        rb.MovePosition(rb.position + movement * moveSpeed * Time.fixedDeltaTime);
    }

    private void Attack()
    {
        canAttack = false;
        
        if (animator != null)
        {
            animator.SetTrigger("Attack");
        }

        Vector2 mousePos = Camera.main.ScreenToWorldPoint(Input.mousePosition);
        Vector2 attackDirection = (mousePos - (Vector2)transform.position).normalized;
        
        if (attackDirection == Vector2.zero)
        {
            attackDirection = lastMoveDirection;
        }

        float angle = Mathf.Atan2(attackDirection.y, attackDirection.x) * Mathf.Rad2Deg;
        Vector2 attackCenter = (Vector2)transform.position + attackDirection * attackForwardDistance;
        
        Collider2D[] hits = Physics2D.OverlapBoxAll(attackCenter, new Vector2(attackWidth, attackHeight), angle);
        
        foreach (Collider2D hit in hits)
        {
            if (hit != null && hit.CompareTag("Enemy"))
            {
                Debug.Log("击中敌人: " + hit.name);
            }
        }

        Invoke(nameof(ResetAttack), attackCooldown);
    }

    private void ResetAttack()
    {
        canAttack = true;
    }

    private void CheckNearbyNPCs()
    {
        Collider2D[] colliders = Physics2D.OverlapCircleAll(transform.position, dialogueRange);
        nearestNPC = null;
        float nearestDistance = float.MaxValue;

        foreach (Collider2D collider in colliders)
        {
            if (collider != null && collider.CompareTag("NPC"))
            {
                NPCController npc = collider.GetComponent<NPCController>();
                if (npc != null)
                {
                    float distance = Vector2.Distance(transform.position, collider.transform.position);
                    if (distance < nearestDistance)
                    {
                        nearestDistance = distance;
                        nearestNPC = npc;
                    }
                }
            }
        }

        if (nearestNPC != null)
        {
            nearestNPC.ShowInteractionIndicator(true);
        }
    }

    private void OnDrawGizmosSelected()
    {
        Vector2 attackDirection = lastMoveDirection != Vector2.zero ? lastMoveDirection : Vector2.right;
        float angle = Mathf.Atan2(attackDirection.y, attackDirection.x) * Mathf.Rad2Deg;
        Vector2 attackCenter = (Vector2)transform.position + attackDirection * attackForwardDistance;

        Gizmos.color = Color.red;
        Matrix4x4 rotationMatrix = Matrix4x4.TRS(attackCenter, Quaternion.Euler(0, 0, angle), Vector3.one);
        Gizmos.matrix = rotationMatrix;
        Gizmos.DrawWireCube(Vector3.zero, new Vector3(attackWidth, attackHeight, 0));
        Gizmos.matrix = Matrix4x4.identity;

        Gizmos.color = Color.blue;
        Gizmos.DrawWireSphere(transform.position, dialogueRange);
    }
}
