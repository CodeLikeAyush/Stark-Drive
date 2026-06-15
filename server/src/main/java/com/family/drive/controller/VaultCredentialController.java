package com.family.drive.controller;

import com.family.drive.model.VaultCredential;
import com.family.drive.model.User;
import com.family.drive.repository.VaultCredentialRepository;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/v1/vault/credentials")
public class VaultCredentialController {

    private final VaultCredentialRepository repository;

    public VaultCredentialController(VaultCredentialRepository repository) {
        this.repository = repository;
    }

    @GetMapping
    public ResponseEntity<List<VaultCredential>> getCredentials(@AuthenticationPrincipal User user) {
        return ResponseEntity.ok(repository.findByUserOrderByTitleAsc(user));
    }

    @PostMapping
    public ResponseEntity<VaultCredential> saveCredential(
            @RequestBody VaultCredential request,
            @AuthenticationPrincipal User user
    ) {
        VaultCredential credential;
        if (request.getId() != null) {
            credential = repository.findById(request.getId())
                    .orElseThrow(() -> new RuntimeException("Credential not found"));
            if (!credential.getUser().getId().equals(user.getId())) {
                throw new RuntimeException("Unauthorized");
            }
            credential.setTitle(request.getTitle());
            credential.setType(request.getType());
            credential.setEncryptedData(request.getEncryptedData());
            credential.setUpdatedAt(request.getUpdatedAt());
        } else {
            credential = new VaultCredential(
                    request.getTitle(),
                    request.getType(),
                    request.getEncryptedData(),
                    user,
                    request.getUpdatedAt()
            );
        }
        return ResponseEntity.ok(repository.save(credential));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> deleteCredential(
            @PathVariable Long id,
            @AuthenticationPrincipal User user
    ) {
        VaultCredential credential = repository.findById(id)
                .orElseThrow(() -> new RuntimeException("Credential not found"));
        if (!credential.getUser().getId().equals(user.getId())) {
            throw new RuntimeException("Unauthorized");
        }
        repository.delete(credential);
        return ResponseEntity.ok().build();
    }
}
