"""Tests for backup/restore round-trip."""
import pytest
import sys
import json
import tarfile
from pathlib import Path
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).parent.parent))

from surge_orchestrator import (
    Config, State, PathResolver, do_backup, do_restore, DockerRunner,
)


class TestDockerRunner:
    """Test DockerRunner soft-fail on missing docker."""

    def test_run_docker_not_found(self):
        """DockerRunner._run returns code 127 if docker not on PATH."""
        runner = DockerRunner(Path("/tmp"), dry_run=False)

        # Mock subprocess.run to raise FileNotFoundError
        with patch("surge_orchestrator.subprocess.run") as mock_run:
            mock_run.side_effect = FileNotFoundError("docker not found")

            result = runner._run(["up"])

            assert result.returncode == 127
            assert b"docker binary not found" in result.stderr

    def test_dry_run_skips_execute(self):
        """DockerRunner with dry_run=True returns code 0 without executing."""
        runner = DockerRunner(Path("/tmp"), dry_run=True)

        with patch("surge_orchestrator.subprocess.run") as mock_run:
            result = runner._run(["up"])

            assert result.returncode == 0
            # Should NOT call subprocess.run
            mock_run.assert_not_called()


class TestBackup:
    """Test backup phase."""

    def test_backup_creates_tarball(self, tmp_path, base_config):
        """do_backup creates a tar.gz with configRoot, state, manifest, config."""
        # Use a custom config root since the test uses Docker platform
        config_root = tmp_path / "srv" / "surge"
        config_root.mkdir(parents=True)
        (config_root / "sonarr").mkdir()
        (config_root / "sonarr" / "config.ini").write_text("api_key=test")

        manifest_file = tmp_path / "manifest.json"
        manifest_file.write_text("{}")

        config_file = tmp_path / "config.json"
        config_file.write_text("{}")

        state_file = tmp_path / ".surge" / "state.json"
        state_file.parent.mkdir()
        state = State()
        state.set_secret("sonarr", "apiKey", "secret123")
        state.save(state_file)

        output_file = tmp_path / "backup.tar.gz"

        config_obj = Config(base_config)
        paths = PathResolver(config_obj)

        # Mock the paths to point to our test config_root
        with patch.object(paths, 'config_root', return_value=str(config_root)):
            docker = Mock(spec=DockerRunner)

            do_backup(
                output_file=output_file,
                manifest_path=manifest_file,
                config_path=config_file,
                config=config_obj,
                state_path=state_file,
                paths=paths,
                docker=docker,
                dry_run=False,
            )

            # Verify docker.down() was called
            docker.down.assert_called_once()

        # Verify tarball was created
        assert output_file.exists()
        assert output_file.stat().st_size > 0

    def test_backup_tar_contents(self, tmp_path, base_config):
        """Backup tarball contains configRoot/, metadata/state.json, etc."""
        config_root = tmp_path / "srv" / "surge"
        config_root.mkdir(parents=True)
        (config_root / "sonarr").mkdir()
        (config_root / "sonarr" / "config.ini").write_text("content")

        manifest_file = tmp_path / "manifest.json"
        manifest_file.write_text("{}")

        config_file = tmp_path / "config.json"
        config_file.write_text("{}")

        state_file = tmp_path / ".surge" / "state.json"
        state_file.parent.mkdir()
        state = State()
        state.set_secret("test", "key", "value")
        state.save(state_file)

        output_file = tmp_path / "backup.tar.gz"

        config_obj = Config(base_config)
        paths = PathResolver(config_obj)
        docker = Mock(spec=DockerRunner)

        with patch.object(paths, 'config_root', return_value=str(config_root)):
            do_backup(
                output_file=output_file,
                manifest_path=manifest_file,
                config_path=config_file,
                config=config_obj,
                state_path=state_file,
                paths=paths,
                docker=docker,
                dry_run=False,
            )

        # Check tar contents
        with tarfile.open(output_file, "r:gz") as tar:
            names = [m.name for m in tar.getmembers()]

            # Should contain configRoot structure
            assert any("configRoot/" in n for n in names)
            assert any("sonarr" in n and "config.ini" in n for n in names)

            # Should contain metadata
            assert "metadata/state.json" in names
            assert "metadata/manifest.json" in names
            assert "metadata/config.json" in names

    def test_backup_docker_restart_on_success(self, tmp_path, base_config):
        """After successful backup, docker.up() is called to restart."""
        config_root = tmp_path / "srv" / "surge"
        config_root.mkdir(parents=True)

        manifest_file = tmp_path / "manifest.json"
        manifest_file.write_text("{}")

        config_file = tmp_path / "config.json"
        config_file.write_text("{}")

        state_file = tmp_path / ".surge" / "state.json"
        state_file.parent.mkdir()
        State().save(state_file)

        output_file = tmp_path / "backup.tar.gz"

        config_obj = Config(base_config)
        paths = PathResolver(config_obj)
        docker = Mock(spec=DockerRunner)

        with patch.object(paths, 'config_root', return_value=str(config_root)):
            do_backup(
                output_file=output_file,
                manifest_path=manifest_file,
                config_path=config_file,
                config=config_obj,
                state_path=state_file,
                paths=paths,
                docker=docker,
                dry_run=False,
            )

        docker.up.assert_called_once()

    def test_backup_dry_run(self, tmp_path, base_config):
        """Backup with dry_run=True doesn't create tarball."""
        config_root = tmp_path / "srv" / "surge"
        config_root.mkdir(parents=True)

        manifest_file = tmp_path / "manifest.json"
        manifest_file.write_text("{}")

        config_file = tmp_path / "config.json"
        config_file.write_text("{}")

        state_file = tmp_path / ".surge" / "state.json"
        state_file.parent.mkdir()
        State().save(state_file)

        output_file = tmp_path / "backup.tar.gz"

        config_obj = Config(base_config)
        paths = PathResolver(config_obj)
        docker = Mock(spec=DockerRunner)

        with patch.object(paths, 'config_root', return_value=str(config_root)):
            do_backup(
                output_file=output_file,
                manifest_path=manifest_file,
                config_path=config_file,
                config=config_obj,
                state_path=state_file,
                paths=paths,
                docker=docker,
                dry_run=True,
            )

        # No tarball should be created
        assert not output_file.exists()
        # No docker operations
        docker.down.assert_not_called()
        docker.up.assert_not_called()

    def test_backup_missing_config_root_fails(self, tmp_path, base_config):
        """Backup with missing configRoot exits with code 1."""
        manifest_file = tmp_path / "manifest.json"
        manifest_file.write_text("{}")

        config_file = tmp_path / "config.json"
        config_file.write_text("{}")

        state_file = tmp_path / "state.json"

        output_file = tmp_path / "backup.tar.gz"

        config_obj = Config(base_config)
        paths = PathResolver(config_obj)
        docker = Mock(spec=DockerRunner)

        with pytest.raises(SystemExit) as exc_info:
            do_backup(
                output_file=output_file,
                manifest_path=manifest_file,
                config_path=config_file,
                config=config_obj,
                state_path=state_file,
                paths=paths,
                docker=docker,
                dry_run=False,
            )
        assert exc_info.value.code == 1


class TestRestore:
    """Test restore phase."""

    def test_restore_extracts_tarball(self, tmp_path, base_config):
        """do_restore extracts configRoot and state.json from backup."""
        # Create a backup tarball
        backup_dir = tmp_path / "backup_src"
        backup_dir.mkdir()

        config_src = backup_dir / "configRoot"
        config_src.mkdir()
        (config_src / "sonarr").mkdir()
        (config_src / "sonarr" / "config.ini").write_text("content=here")

        state_src = backup_dir / "state.json"
        state = State()
        state.set_secret("sonarr", "apiKey", "persisted-secret")
        state.save(state_src)

        # Create the tar
        tar_file = tmp_path / "backup.tar.gz"
        with tarfile.open(tar_file, "w:gz") as tar:
            tar.add(config_src, arcname="configRoot")
            tar.add(state_src, arcname="metadata/state.json")

        # Prepare restore target
        restore_root = tmp_path / "restore"
        restore_root.mkdir()

        config_obj = Config(base_config)
        paths = PathResolver(config_obj)

        # Mock PathResolver to return our restore root
        with patch.object(paths, 'config_root', return_value=str(restore_root)):
            docker = Mock(spec=DockerRunner)
            state_path = restore_root / ".surge" / "state.json"

            do_restore(
                input_file=tar_file,
                paths=paths,
                state_path=state_path,
                docker=docker,
                dry_run=False,
            )

            # Verify configRoot was extracted
            assert (restore_root / "sonarr" / "config.ini").exists()
            assert (restore_root / "sonarr" / "config.ini").read_text() == "content=here"

            # Verify state.json was extracted
            assert state_path.exists()
            loaded_state = State.load(state_path)
            assert loaded_state.get_secret("sonarr", "apiKey") == "persisted-secret"

    def test_restore_missing_backup_fails(self, tmp_path, base_config):
        """Restore with missing backup file exits with code 1."""
        backup_file = tmp_path / "nonexistent.tar.gz"

        config_obj = Config(base_config)
        paths = PathResolver(config_obj)
        docker = Mock(spec=DockerRunner)

        with pytest.raises(SystemExit) as exc_info:
            do_restore(
                input_file=backup_file,
                paths=paths,
                state_path=tmp_path / "state.json",
                docker=docker,
                dry_run=False,
            )
        assert exc_info.value.code == 1

    def test_restore_docker_down_then_up(self, tmp_path, base_config):
        """Restore calls docker.down() then docker.up()."""
        backup_dir = tmp_path / "backup_src"
        backup_dir.mkdir()
        (backup_dir / "configRoot").mkdir()

        tar_file = tmp_path / "backup.tar.gz"
        with tarfile.open(tar_file, "w:gz") as tar:
            tar.add(backup_dir / "configRoot", arcname="configRoot")

        restore_root = tmp_path / "restore"
        restore_root.mkdir()

        config_obj = Config(base_config)
        paths = PathResolver(config_obj)

        with patch.object(paths, 'config_root', return_value=str(restore_root)):
            docker = Mock(spec=DockerRunner)

            do_restore(
                input_file=tar_file,
                paths=paths,
                state_path=restore_root / "state.json",
                docker=docker,
                dry_run=False,
            )

            # Should call down then up
            docker.down.assert_called_once()
            docker.up.assert_called_once()

    def test_restore_dry_run(self, tmp_path, base_config):
        """Restore with dry_run=True doesn't extract anything."""
        backup_dir = tmp_path / "backup_src"
        backup_dir.mkdir()
        (backup_dir / "configRoot").mkdir()

        tar_file = tmp_path / "backup.tar.gz"
        with tarfile.open(tar_file, "w:gz") as tar:
            tar.add(backup_dir / "configRoot", arcname="configRoot")

        restore_root = tmp_path / "restore"
        restore_root.mkdir()

        config_obj = Config(base_config)
        paths = PathResolver(config_obj)

        with patch.object(paths, 'config_root', return_value=str(restore_root)):
            docker = Mock(spec=DockerRunner)

            do_restore(
                input_file=tar_file,
                paths=paths,
                state_path=restore_root / "state.json",
                docker=docker,
                dry_run=True,
            )

            # Nothing should be extracted
            assert not (restore_root / "sonarr").exists()
            # No docker operations
            docker.down.assert_not_called()
            docker.up.assert_not_called()


class TestBackupRestoreRoundTrip:
    """Test end-to-end backup -> restore -> verify."""

    def test_roundtrip_preserves_state(self, tmp_path, base_config):
        """Backup and restore preserves secrets and runtime values."""
        # Setup initial state
        config_root = tmp_path / "original" / "configRoot"
        config_root.mkdir(parents=True)
        (config_root / "sonarr").mkdir()
        (config_root / "sonarr" / "config.ini").write_text("API_KEY=original")

        manifest_file = tmp_path / "manifest.json"
        manifest_file.write_text("{}")

        config_file = tmp_path / "config.json"
        config_file.write_text("{}")

        state_file = tmp_path / ".surge" / "state.json"
        state_file.parent.mkdir()
        state = State()
        state.set_secret("sonarr", "apiKey", "secret-to-preserve")
        state.set_runtime("sonarr", "baseUrl", "http://sonarr:8989")
        state.save(state_file)

        backup_file = tmp_path / "backup.tar.gz"

        # Backup
        config_obj = Config(base_config)
        paths = PathResolver(config_obj)
        with patch.object(paths, 'config_root', return_value=str(config_root)):
            docker = Mock(spec=DockerRunner)

            do_backup(
                output_file=backup_file,
                manifest_path=manifest_file,
                config_path=config_file,
                config=config_obj,
                state_path=state_file,
                paths=paths,
                docker=docker,
                dry_run=False,
            )

        # Restore to a new location
        restore_root = tmp_path / "restored"
        restore_root.mkdir()

        with patch.object(paths, 'config_root', return_value=str(restore_root)):
            docker = Mock(spec=DockerRunner)
            restored_state_file = restore_root / ".surge" / "state.json"

            do_restore(
                input_file=backup_file,
                paths=paths,
                state_path=restored_state_file,
                docker=docker,
                dry_run=False,
            )

        # Verify restored state
        assert (restore_root / "sonarr" / "config.ini").read_text() == "API_KEY=original"

        restored_state = State.load(restored_state_file)
        assert restored_state.get_secret("sonarr", "apiKey") == "secret-to-preserve"
        assert restored_state.get_runtime("sonarr", "baseUrl") == "http://sonarr:8989"
