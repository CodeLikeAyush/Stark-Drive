package com.family.drive.controller;

import com.family.drive.dto.ContactSyncRequest;
import com.family.drive.model.Contact;
import com.family.drive.model.User;
import com.family.drive.service.ContactService;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/v1/contacts")
public class ContactController {

    private final ContactService service;

    public ContactController(ContactService service) {
        this.service = service;
    }

    @GetMapping
    public ResponseEntity<List<Contact>> listContacts(@AuthenticationPrincipal User user) {
        return ResponseEntity.ok(service.listContacts(user));
    }

    @PostMapping("/sync")
    public ResponseEntity<Void> syncContacts(
            @RequestBody List<ContactSyncRequest> requests,
            @AuthenticationPrincipal User user
    ) {
        service.syncContacts(requests, user);
        return ResponseEntity.ok().build();
    }

    @DeleteMapping("/{deviceContactId}")
    public ResponseEntity<Void> deleteContact(
            @PathVariable String deviceContactId,
            @AuthenticationPrincipal User user
    ) {
        service.deleteContact(deviceContactId, user);
        return ResponseEntity.ok().build();
    }
}
