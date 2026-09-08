import Lynx
import UIKit

// MARK: - Home

/// Landing screen: pick a bundle URL, then push a full-screen player for it.
final class HomeViewController: UIViewController {
  private static let urlDefaultsKey = "lfi.bundleURL"
  private static let fallbackURL = "http://localhost:3000/main.lynx.bundle"

  private var savedURL: String {
    get { UserDefaults.standard.string(forKey: Self.urlDefaultsKey) ?? Self.fallbackURL }
    set { UserDefaults.standard.set(newValue, forKey: Self.urlDefaultsKey) }
  }

  private let urlField: UITextField = {
    let field = UITextField()
    field.borderStyle = .roundedRect
    field.font = .monospacedSystemFont(ofSize: 13, weight: .regular)
    field.autocapitalizationType = .none
    field.autocorrectionType = .no
    field.keyboardType = .URL
    field.clearButtonMode = .whileEditing
    field.returnKeyType = .go
    field.placeholder = "http://<mac-ip>:3000/main.lynx.bundle"
    return field
  }()

  override func viewDidLoad() {
    super.viewDidLoad()
    title = "lynx-fast-image"
    view.backgroundColor = .systemBackground

    let hint = UILabel()
    hint.text = "Bundle URL"
    hint.font = .systemFont(ofSize: 13, weight: .semibold)
    hint.textColor = .secondaryLabel

    let loadButton = UIButton(type: .system)
    loadButton.setTitle("Load full screen", for: .normal)
    loadButton.titleLabel?.font = .systemFont(ofSize: 17, weight: .semibold)
    loadButton.addTarget(self, action: #selector(loadTapped), for: .touchUpInside)

    let stack = UIStackView(arrangedSubviews: [hint, urlField, loadButton])
    stack.axis = .vertical
    stack.spacing = 10
    stack.alignment = .fill
    stack.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(stack)

    NSLayoutConstraint.activate([
      stack.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 24),
      stack.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 16),
      stack.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -16),
    ])

    urlField.text = savedURL
    urlField.delegate = self
  }

  @objc private func loadTapped() {
    urlField.resignFirstResponder()
    let entered = (urlField.text ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    guard !entered.isEmpty, URLComponents(string: entered)?.url != nil else {
      urlField.text = savedURL
      return
    }
    savedURL = entered
    navigationController?.pushViewController(LynxPlayerViewController(bundleURL: entered),
                                            animated: true)
  }
}

extension HomeViewController: UITextFieldDelegate {
  func textFieldShouldReturn(_ textField: UITextField) -> Bool {
    loadTapped()
    return true
  }
}

// MARK: - Full-screen player

/// Full-screen `LynxView` for one bundle URL. Owns the HTTP fetch + DevTool /
/// Fast Refresh wiring.
final class LynxPlayerViewController: UIViewController {
  private let bundleURLString: String
  private let resourceFetcher = HTTPResourceFetcher()

  private var pendingTemplate: Data?
  private var didRenderTemplate = false

  init(bundleURL: String) {
    self.bundleURLString = bundleURL
    super.init(nibName: nil, bundle: nil)
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError() }

  private lazy var lynxView: LynxView = {
    LynxView { [resourceFetcher] builder in
      builder.config = LynxConfig(provider: nil)
      if let elementClass = NSClassFromString("LynxFastImageElement") {
        builder.config?.registerUI(elementClass, withName: "x-lynx-fast-image")
      }
      builder.enableGenericResourceFetcher = .true
      builder.genericResourceFetcher = resourceFetcher
      builder.fontScale = 1
      #if DEBUG
        builder.debuggable = true
        if let ws = NSClassFromString("LynxWebSocketModule") as? LynxModule.Type {
          builder.config?.register(ws)
        }
      #endif
    }
  }()

  private let statusLabel: UILabel = {
    let label = UILabel()
    label.numberOfLines = 0
    label.textAlignment = .center
    label.font = .systemFont(ofSize: 13)
    label.textColor = .secondaryLabel
    return label
  }()

  private lazy var backButton: UIButton = {
    let b = UIButton(type: .system)
    b.setTitle("‹ URL", for: .normal)
    b.setTitleColor(.white, for: .normal)
    b.titleLabel?.font = .systemFont(ofSize: 15, weight: .semibold)
    b.backgroundColor = UIColor.black.withAlphaComponent(0.45)
    b.contentEdgeInsets = .init(top: 6, left: 12, bottom: 6, right: 14)
    b.layer.cornerRadius = 15
    b.clipsToBounds = true
    b.addTarget(self, action: #selector(back), for: .touchUpInside)
    return b
  }()

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = .black
    navigationController?.setNavigationBarHidden(true, animated: false)

    // Edge-to-edge LynxView (frame-driven; see viewDidLayoutSubviews).
    lynxView.layoutWidthMode = .exact
    lynxView.layoutHeightMode = .exact
    lynxView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    view.addSubview(lynxView)

    statusLabel.translatesAutoresizingMaskIntoConstraints = false
    backButton.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(statusLabel)
    view.addSubview(backButton)

    NSLayoutConstraint.activate([
      statusLabel.centerXAnchor.constraint(equalTo: view.centerXAnchor),
      statusLabel.centerYAnchor.constraint(equalTo: view.centerYAnchor),
      statusLabel.widthAnchor.constraint(lessThanOrEqualTo: view.widthAnchor, multiplier: 0.85),
      backButton.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 6),
      backButton.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 12),
    ])

    loadBundle()
  }

  override func viewWillDisappear(_ animated: Bool) {
    super.viewWillDisappear(animated)
    navigationController?.setNavigationBarHidden(false, animated: animated)

    // `isMovingFromParent` is true only on a real pop (back button / swipe),
    // not when another screen is pushed on top of this one.
    if isMovingFromParent {
      teardownLynx()
    }
  }

  /// Called once, when this screen is popped off the nav stack for good.
  /// Tears the Lynx engine down deterministically so a long session of
  /// Load → back → Load cycles doesn't leak JS-runtime / layout threads.
  private func teardownLynx() {
    lynxView.clearForDestroy()
  }

  override func viewDidLayoutSubviews() {
    super.viewDidLayoutSubviews()
    let target = view.bounds
    guard target.width > 1, target.height > 1 else { return }
    if lynxView.frame != target {
      lynxView.frame = target
      lynxView.preferredLayoutWidth = target.width
      lynxView.preferredLayoutHeight = target.height
      lynxView.updateViewport(withPreferredLayoutWidth: target.width,
                              preferredLayoutHeight: target.height)
      if didRenderTemplate { lynxView.triggerLayout() }
    }
    renderPendingTemplateIfPossible()
  }

  @objc private func back() {
    navigationController?.popViewController(animated: true)
  }

  // MARK: - Rendering

  private func setStatus(_ text: String?) {
    DispatchQueue.main.async { self.statusLabel.text = text }
  }

  private func render(_ data: Data) {
    DispatchQueue.main.async {
      self.pendingTemplate = data
      self.renderPendingTemplateIfPossible()
    }
  }

  private func renderPendingTemplateIfPossible() {
    guard !didRenderTemplate, let data = pendingTemplate,
          lynxView.bounds.width > 1, lynxView.bounds.height > 1 else { return }
    didRenderTemplate = true
    setStatus(nil)
    lynxView.loadTemplate(data, withURL: bundleURLString)
  }

  private func loadBundle() {
    guard var components = URLComponents(string: bundleURLString) else {
      setStatus("Bad bundle URL:\n\(bundleURLString)")
      return
    }
    components.queryItems = (components.queryItems ?? []) + [
      URLQueryItem(name: "t", value: String(Int(Date().timeIntervalSince1970)))
    ]
    guard let url = components.url else {
      setStatus("Bad bundle URL:\n\(bundleURLString)")
      return
    }

    setStatus("Loading \(bundleURLString)…")

    var request = URLRequest(url: url)
    request.timeoutInterval = 10
    request.cachePolicy = .reloadIgnoringLocalCacheData

    URLSession.shared.dataTask(with: request) { [weak self] data, response, error in
      guard let self else { return }
      if let error = error as NSError? {
        let hint = error.code == NSURLErrorCannotConnectToHost || error.code == NSURLErrorTimedOut
          ? "\nIs `pnpm dev` running, and is the IP correct?"
          : ""
        self.setStatus("Fetch failed: \(error.localizedDescription)\(hint)")
        return
      }
      if let http = response as? HTTPURLResponse, http.statusCode != 200 {
        self.setStatus("Server returned HTTP \(http.statusCode)")
        return
      }
      guard let data, !data.isEmpty else {
        self.setStatus("Empty bundle response")
        return
      }
      self.render(data)
    }.resume()
  }
}

// MARK: - Resource fetcher

/// Minimal HTTP(S) generic-resource fetcher. Lynx needs one to pull rspeedy's
/// `*.hot-update.json` chunks (and fonts / ExternalJS); without it Fast Refresh
/// logs `lynx resource provider is null`.
final class HTTPResourceFetcher: NSObject, LynxGenericResourceFetcher {
  func fetchResource(
    _ request: LynxResourceRequest,
    onComplete callback: @escaping (Data?, Error?) -> Void
  ) -> (() -> Void) {
    guard let url = URL(string: request.url) else {
      callback(nil, NSError(domain: "lfi.resource", code: -1,
                            userInfo: [NSLocalizedDescriptionKey: "bad url: \(request.url)"]))
      return {}
    }
    let task = URLSession.shared.dataTask(with: url) { data, _, error in
      callback(data, error)
    }
    task.resume()
    return { task.cancel() }
  }

  func fetchResourcePath(
    _ request: LynxResourceRequest,
    onComplete callback: @escaping (String?, Error?) -> Void
  ) -> (() -> Void) {
    callback(nil, NSError(domain: "lfi.resource", code: -2,
                          userInfo: [NSLocalizedDescriptionKey: "no on-disk path for \(request.url)"]))
    return {}
  }
}
