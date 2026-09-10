package expo.modules.lynx

import java.io.File
import java.nio.file.Files
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * B4 (#17) regression tests — criterion 9: a template requesting `../` outside
 * its resource root must fail to load rather than resolving.
 */
class LynxResourcePathTest {
  private lateinit var root: File

  @Before
  fun setUp() {
    root = Files.createTempDirectory("lynx-root").toFile()
    File(root, "assets").mkdirs()
    File(root, "assets/app.js").writeText("//")
  }

  @After
  fun tearDown() {
    root.deleteRecursively()
    root.parentFile?.let { File(it, "secret.txt").delete() }
  }

  @Test
  fun `a plain relative path normalizes unchanged`() {
    assertEquals("assets/app.js", LynxResourcePath.normalize("assets/app.js"))
    assertEquals("main.lynx.bundle", LynxResourcePath.normalize("/main.lynx.bundle"))
    assertEquals("a/b/c.png", LynxResourcePath.normalize("bundle://a/b/c.png"))
  }

  @Test
  fun `a percent-encoded space decodes but a plus sign is preserved`() {
    assertEquals("my dir/a.js", LynxResourcePath.normalize("my%20dir/a.js"))
    assertEquals("c++/gen.js", LynxResourcePath.normalize("c++/gen.js"))
  }

  @Test
  fun `dot-dot traversal is rejected`() {
    assertNull(LynxResourcePath.normalize("../secret.txt"))
    assertNull(LynxResourcePath.normalize("assets/../../secret.txt"))
    assertNull(LynxResourcePath.normalize("a/./b"))
    assertNull(LynxResourcePath.normalize("%2e%2e/secret.txt"))
  }

  @Test
  fun `an explicit non-bundle scheme is rejected`() {
    assertNull(LynxResourcePath.normalize("file:///etc/passwd"))
    assertNull(LynxResourcePath.normalize("http://evil.example/x.js"))
    assertNull(LynxResourcePath.normalize("content://media/external/x"))
  }

  @Test
  fun `an empty or slash-only path is rejected`() {
    assertNull(LynxResourcePath.normalize(""))
    assertNull(LynxResourcePath.normalize("///"))
  }

  @Test
  fun `isContained accepts the root and paths beneath it`() {
    assertTrue(LynxResourcePath.isContained(root, File(root, "assets/app.js")))
    assertTrue(LynxResourcePath.isContained(root, root))
  }

  @Test
  fun `isContained rejects a sibling that shares a name prefix`() {
    val sibling = File(root.parentFile, root.name + "-evil")
    sibling.mkdirs()
    try {
      assertFalse(LynxResourcePath.isContained(root, File(sibling, "x.js")))
    } finally {
      sibling.deleteRecursively()
    }
  }

  @Test
  fun `isContained rejects a resolved-out escape even without literal dot-dot`() {
    // `File(root, "../secret.txt")` still resolves outside once canonicalized —
    // the containment check is the second line of defense behind normalize().
    val escape = File(root, "../secret.txt")
    assertFalse(LynxResourcePath.isContained(root, escape))
  }
}
