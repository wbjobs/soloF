using UnityEngine;
using UnityEngine.UIElements;
using Unity.Entities;

public class SpaceTrafficUI : MonoBehaviour
{
    private Label _shipCountLabel;
    private Label _latencyLabel;
    private VisualElement _root;

    void Start()
    {
        var uiDocument = GetComponent<UIDocument>();
        if (uiDocument == null)
        {
            uiDocument = gameObject.AddComponent<UIDocument>();
        }

        _root = uiDocument.rootVisualElement;
        _root.styleSheets.Add(Resources.Load<StyleSheet>("SpaceTrafficStyles"));

        CreateUI();
    }

    private void CreateUI()
    {
        var container = new VisualElement
        {
            name = "stats-container"
        };
        container.style.position = Position.Absolute;
        container.style.top = 20;
        container.style.left = 20;
        container.style.backgroundColor = new Color(0, 0, 0, 0.7f);
        container.style.paddingLeft = 15;
        container.style.paddingRight = 15;
        container.style.paddingTop = 10;
        container.style.paddingBottom = 10;
        container.style.borderTopLeftRadius = 8;
        container.style.borderTopRightRadius = 8;
        container.style.borderBottomLeftRadius = 8;
        container.style.borderBottomRightRadius = 8;

        var title = new Label("太空交通管理系统")
        {
            name = "title"
        };
        title.style.fontSize = 18;
        title.style.color = Color.cyan;
        title.style.unityFontStyleAndWeight = FontStyle.Bold;
        title.style.marginBottom = 10;

        _shipCountLabel = new Label("活跃飞船: 0")
        {
            name = "ship-count"
        };
        _shipCountLabel.style.fontSize = 14;
        _shipCountLabel.style.color = Color.white;
        _shipCountLabel.style.marginBottom = 5;

        _latencyLabel = new Label("平均延迟: 0.00 ms")
        {
            name = "latency"
        };
        _latencyLabel.style.fontSize = 14;
        _latencyLabel.style.color = Color.white;

        container.Add(title);
        container.Add(_shipCountLabel);
        container.Add(_latencyLabel);

        _root.Add(container);
    }

    void Update()
    {
        if (World.DefaultGameObjectInjectionWorld == null) return;

        var entityManager = World.DefaultGameObjectInjectionWorld.EntityManager;
        var query = entityManager.CreateEntityQuery(typeof(ShipStats));

        if (query.CalculateEntityCount() > 0)
        {
            var stats = query.GetSingleton<ShipStats>();
            _shipCountLabel.text = $"活跃飞船: {stats.ActiveShipCount}";
            _latencyLabel.text = $"平均延迟: {stats.AverageLatencyMs:F2} ms";

            if (stats.AverageLatencyMs > 10f)
            {
                _latencyLabel.style.color = Color.red;
            }
            else if (stats.AverageLatencyMs > 5f)
            {
                _latencyLabel.style.color = Color.yellow;
            }
            else
            {
                _latencyLabel.style.color = Color.green;
            }
        }

        query.Dispose();
    }
}
